using System;
using System.IO;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace StreamRecordSetup {
    [DataContract] internal sealed class Artifact {
        [DataMember] public string name { get; set; }
        [DataMember] public long bytes { get; set; }
        [DataMember] public string sha256 { get; set; }
    }
    [DataContract] internal sealed class Release {
        [DataMember] public string version { get; set; }
        [DataMember] public string variant { get; set; }
        [DataMember] public Artifact installer { get; set; }
        [DataMember] public Artifact[] parts { get; set; }
        public static Release Embedded() {
            using (var stream = typeof(Release).Assembly.GetManifestResourceStream("release.json")) {
                var release = (Release)new DataContractJsonSerializer(typeof(Release)).ReadObject(stream);
                if (release.version != "0.6.5" || release.variant != "cpu" || release.parts.Length != 5)
                    throw new InvalidDataException("지원하지 않는 배포 정보입니다.");
                return release;
            }
        }
    }
    internal sealed class DownloadProgress {
        public readonly long Bytes;
        public readonly long Total;
        public readonly string Stage;
        public DownloadProgress(long bytes, long total, string stage) { Bytes=bytes; Total=total; Stage=stage; }
    }
    internal sealed class Download {
        private readonly Release release;
        private readonly string directory;
        private readonly IProgress<DownloadProgress> progress;
        public Download(Release release, string directory, IProgress<DownloadProgress> progress) {
            this.release=release; this.directory=directory; this.progress=progress;
        }
        public static void PlainPath(string path) {
            for(var current=new DirectoryInfo(Path.GetFullPath(path)); current!=null; current=current.Parent)
                if(current.Exists && (current.Attributes & FileAttributes.ReparsePoint)!=0)
                    throw new IOException("다운로드 폴더의 연결 경로는 사용할 수 없습니다.");
        }
        public static void Verify(Stream stream, Artifact artifact) {
            if(stream.Length!=artifact.bytes) throw new InvalidDataException("파일 크기가 일치하지 않습니다.");
            stream.Position=0;
            using(var hash=SHA256.Create()) {
                var actual=BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if(actual!=artifact.sha256) throw new InvalidDataException("파일 검증 실패: "+artifact.name);
            }
            stream.Position=0;
        }
        private bool Cached(string file, Artifact artifact) {
            if(!File.Exists(file)) return false;
            if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0) throw new IOException("연결 파일은 사용할 수 없습니다.");
            try { using(var input=File.OpenRead(file)) Verify(input,artifact); return true; }
            catch(InvalidDataException) { return false; }
        }
        public async Task<string> Prepare(CancellationToken token) {
            PlainPath(directory); Directory.CreateDirectory(directory);
            long completed=0;
            {
                foreach(var part in release.parts) {
                    token.ThrowIfCancellationRequested();
                    var file=Path.Combine(directory,part.name);
                    if(!Cached(file,part)) {
                        for(var attempt=0; ; attempt++) {
                            try { await Fetch(part,completed,token); break; }
                            catch(IOException) { if(attempt>=2) throw; }
                            await Task.Delay(1000*(attempt+1),token);
                        }
                    }
                    completed+=part.bytes;
                    progress.Report(new DownloadProgress(completed,release.installer.bytes,"다운로드"));
                }
            }
            var installer=Path.Combine(directory,release.installer.name);
            progress.Report(new DownloadProgress(completed,release.installer.bytes,"설치파일 검증"));
            if(Cached(installer,release.installer)) return installer;
            var assembling=installer+".assembling";
            using(var output=new FileStream(assembling,FileMode.Create,FileAccess.Write,FileShare.None)) {
                foreach(var part in release.parts) {
                    token.ThrowIfCancellationRequested();
                    using(var input=File.OpenRead(Path.Combine(directory,part.name))) {
                        Verify(input,part); await input.CopyToAsync(output,65536,token);
                    }
                }
                output.Flush(true);
            }
            using(var input=File.OpenRead(assembling)) Verify(input,release.installer);
            token.ThrowIfCancellationRequested();
            if(File.Exists(installer)) throw new IOException("기존 설치파일이 손상되었습니다. 새 설치 EXE를 다시 실행하세요.");
            File.Move(assembling,installer);
            return installer;
        }
        private async Task Fetch(Artifact part, long completed, CancellationToken token) {
            var temporary=Path.Combine(directory,part.name)+".download";
            await NativeTransport.Fetch(release.version,part,directory,temporary,bytes=>progress.Report(new DownloadProgress(completed+bytes,release.installer.bytes,"다운로드")),token);
            using(var input=File.OpenRead(temporary)) Verify(input,part);
            var final=Path.Combine(directory,part.name);
            if(File.Exists(final)) File.Delete(final);
            File.Move(temporary,final);
        }
    }
}
