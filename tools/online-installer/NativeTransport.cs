using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.Serialization.Json;
using System.Threading;
using System.Threading.Tasks;

namespace StreamRecordSetup {
    internal static class NativeTransport {
        private static Artifact Metadata() {
            using(var stream=typeof(NativeTransport).Assembly.GetManifestResourceStream("downloader.json"))
                return (Artifact)new DataContractJsonSerializer(typeof(Artifact)).ReadObject(stream);
        }
        public static string LicenseText() {
            using(var stream=typeof(NativeTransport).Assembly.GetManifestResourceStream("THIRD_PARTY_NOTICES.txt"))
            using(var reader=new StreamReader(stream)) return reader.ReadToEnd();
        }
        public static string Helper(string directory) {
            Download.PlainPath(directory); Directory.CreateDirectory(directory);
            var metadata=Metadata();
            if(metadata.name!="streamrecord-download.exe") throw new InvalidDataException("다운로드 모듈 정보 오류");
            var file=Path.Combine(directory,metadata.name);
            if(File.Exists(file)) {
                if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0) throw new IOException("연결 파일은 사용할 수 없습니다.");
            } else {
                using(var input=typeof(NativeTransport).Assembly.GetManifestResourceStream("download-helper.exe"))
                using(var output=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.None)) { input.CopyTo(output); output.Flush(true); }
            }
            using(var stream=File.OpenRead(file)) Download.Verify(stream,metadata);
            var notice=Path.Combine(directory,"THIRD_PARTY_NOTICES.txt");
            if(!File.Exists(notice)) using(var writer=new StreamWriter(new FileStream(notice,FileMode.CreateNew,FileAccess.Write,FileShare.None))) writer.Write(LicenseText());
            return file;
        }
        private static void Stop(Process child) {
            try { if(!child.HasExited) child.Kill(); }
            catch(InvalidOperationException) {}
            catch(Win32Exception) {}
        }
        public static async Task CopyProcess(ProcessStartInfo start,string destination,Artifact part,Action<long> report,CancellationToken token) {
            token.ThrowIfCancellationRequested();
            start.UseShellExecute=false; start.CreateNoWindow=true;
            start.RedirectStandardOutput=true; start.RedirectStandardError=true;
            using(var child=Process.Start(start)) {
                if(child==null) throw new IOException("다운로드 모듈을 실행하지 못했습니다.");
                using(token.Register(()=>Stop(child))) {
                    var error=child.StandardError.ReadToEndAsync();
                    try {
                        using(var output=new FileStream(destination,FileMode.Create,FileAccess.Write,FileShare.None)) {
                            var buffer=new byte[65536]; long received=0;
                            while(true) {
                                int count;
                                using(var timeout=CancellationTokenSource.CreateLinkedTokenSource(token)) {
                                    timeout.CancelAfter(TimeSpan.FromSeconds(45));
                                    using(timeout.Token.Register(()=>Stop(child))) {
                                        try { count=await child.StandardOutput.BaseStream.ReadAsync(buffer,0,buffer.Length,timeout.Token); }
                                        catch(OperationCanceledException) { token.ThrowIfCancellationRequested();throw new IOException("다운로드 응답 시간이 초과되었습니다."); }
                                        token.ThrowIfCancellationRequested();
                                        if(timeout.IsCancellationRequested) throw new IOException("다운로드 응답 시간이 초과되었습니다.");
                                    }
                                }
                                if(count==0) break;
                                received+=count;
                                if(received>part.bytes) throw new InvalidDataException("다운로드 파일이 예상 크기를 초과했습니다.");
                                await output.WriteAsync(buffer,0,count,token); report(received);
                            }
                            output.Flush(true);
                        }
                        await Task.Run(()=>child.WaitForExit());token.ThrowIfCancellationRequested();
                        var detail=await error;
                        if(child.ExitCode!=0) throw new IOException("다운로드 모듈 오류 ("+child.ExitCode+"): "+detail.Substring(0,Math.Min(detail.Length,400)));
                        if(new FileInfo(destination).Length!=part.bytes) throw new InvalidDataException("다운로드 크기가 일치하지 않습니다.");
                    } catch { token.ThrowIfCancellationRequested();throw; }
                    finally { Stop(child); }
                }
            }
        }
        public static async Task Fetch(string version,Artifact part,string directory,string destination,Action<long> progress,CancellationToken token) {
            var helper=Helper(directory);
            using(var locked=new FileStream(helper,FileMode.Open,FileAccess.Read,FileShare.Read)) {
                Download.Verify(locked,Metadata());
                var start=new ProcessStartInfo(helper,version+" "+part.name+" "+part.bytes.ToString(System.Globalization.CultureInfo.InvariantCulture)) { WorkingDirectory=directory };
                await CopyProcess(start,destination,part,progress,token);
            }
        }
    }
}
