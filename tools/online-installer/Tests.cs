using System;
using System.IO;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
namespace StreamRecordSetup {
    internal static class Tests {
        private static Artifact Sample(byte[] bytes) {
            using(var hash=SHA256.Create()) return new Artifact { name="fixture",bytes=bytes.Length,sha256=BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant() };
        }
        [STAThread] private static int Main(string[] args) {
            Console.OutputEncoding=System.Text.Encoding.UTF8;
            var downloadsOnly=args.Length==1 && args[0]=="--downloads-only";
            try { Run(!downloadsOnly).GetAwaiter().GetResult(); Console.WriteLine(downloadsOnly?"PASS: 12 download, access-denial and error layout checks; 2 installer execution checks NOT_RUN (download-only scope)":"PASS: 14 checks (7 installer checks; native pipe success, failed exit, oversized output, child cancellation, helper tampering, blocked helper guidance, error layout)");return 0; }
            catch(Exception error) { Console.Error.WriteLine(error);return 1; }
        }
        private static async Task Run(bool installationChecks) {
            var originalContext=SynchronizationContext.Current;
            // An inner OS error must not erase recovery guidance, and long guidance must fit the actual window.
            using(var window=new SetupWindow(true,false,false)) {
                var guidance="다운로드 모듈을 실행하지 못했습니다: streamrecord-download.exe (Windows 오류 5). Windows가 파일 실행을 거부했습니다. 보안 프로그램의 차단 기록과 파일 실행 권한을 확인하세요. GitLab 배포 페이지에서 전체 설치 파일을 받아 Stream-Record를 종료한 뒤 설치할 수 있습니다.";
                window.ShowFailure(new IOException(guidance,new System.ComponentModel.Win32Exception(5)));
                var status=System.Linq.Enumerable.Single(System.Linq.Enumerable.OfType<System.Windows.Forms.Label>(window.Controls),label=>label.Text.StartsWith("설치 진행 실패"));
                if(!status.Text.Contains(guidance)) throw new Exception("Recovery context was replaced by inner OS error");
                var required=System.Windows.Forms.TextRenderer.MeasureText(status.Text,status.Font,new System.Drawing.Size(status.Width,int.MaxValue),System.Windows.Forms.TextFormatFlags.WordBreak|System.Windows.Forms.TextFormatFlags.TextBoxControl).Height;
                if(status.Height<required || window.ClientSize.Height<=295) throw new Exception("Error guidance is clipped");
                foreach(System.Windows.Forms.Control control in window.Controls) if(control.Bottom>window.ClientSize.Height) throw new Exception("Error window clipped a control");
                var bar=System.Linq.Enumerable.Single(System.Linq.Enumerable.OfType<System.Windows.Forms.ProgressBar>(window.Controls));
                if(bar.Top<status.Bottom) throw new Exception("Progress bar overlaps guidance");
                using(var bitmap=new System.Drawing.Bitmap(window.ClientSize.Width,window.ClientSize.Height)) {
                    using(var graphics=System.Drawing.Graphics.FromImage(bitmap)) graphics.Clear(System.Drawing.SystemColors.Control);
                    foreach(System.Windows.Forms.Control control in window.Controls) control.DrawToBitmap(bitmap,control.Bounds);
                    bitmap.Save(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"error-guidance.png"),System.Drawing.Imaging.ImageFormat.Png);
                }
            }
            SynchronizationContext.SetSynchronizationContext(originalContext);
            // Given a known artifact, when a same-size byte is changed, then verification fails.
            var original=new byte[]{1,2,3,4};var artifact=Sample(original);
            using(var changed=new MemoryStream(new byte[]{1,2,3,5})) {
                try { Download.Verify(changed,artifact);throw new Exception("Changed bytes accepted"); } catch(InvalidDataException) {}
            }
            // Given a known artifact, when it is truncated, then verification fails.
            using(var truncated=new MemoryStream(new byte[]{1,2,3})) {
                try { Download.Verify(truncated,artifact);throw new Exception("Truncated file accepted"); } catch(InvalidDataException) {}
            }
            var root=Path.Combine(Path.GetTempPath(),"StreamRecordSetup-Test-"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(root);
            var first=Sample(new byte[]{1,2});first.name="first";var second=Sample(new byte[]{3,4});second.name="second";
            var installer=Sample(original);installer.name="fixture.exe";
            var release=new Release { version="test",variant="cpu",installer=installer,parts=new[]{first,second} };
            File.WriteAllBytes(Path.Combine(root,first.name),new byte[]{1,2});File.WriteAllBytes(Path.Combine(root,second.name),new byte[]{3,4});
            var download=new Download(release,root,new Progress<DownloadProgress>());
            // Given verified cached parts, when preparation is cancelled, then no installer is created.
            var cancelled=new CancellationToken(true);
            try { await download.Prepare(cancelled);throw new Exception("Cancellation ignored"); } catch(OperationCanceledException) {}
            if(File.Exists(Path.Combine(root,installer.name))) throw new Exception("Cancelled operation assembled installer");
            // Given verified cached parts, when assembled offline, then the expected bytes survive.
            var file=await download.Prepare(CancellationToken.None);
            if(!System.Linq.Enumerable.SequenceEqual(File.ReadAllBytes(file),original)) throw new Exception("Wrong reconstruction");
            // Given an altered existing installer, when preparation is repeated, then it is preserved and rejected.
            File.WriteAllBytes(file,new byte[]{9});
            try { await download.Prepare(CancellationToken.None);throw new Exception("Existing file overwritten"); } catch(IOException) {}
            if(File.ReadAllBytes(file)[0]!=9) throw new Exception("Existing file changed");
            // Given a real child EXE, when installation runs, then silent install and app launch flags reach it.
            var child=Path.Combine(root,"child.exe");File.Copy(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"fixture-installer.exe"),child);
            if(installationChecks) {
                var childArtifact=Sample(File.ReadAllBytes(child));childArtifact.name="child.exe";
                var childRelease=new Release { installer=childArtifact };
                await Install.Run(child,childRelease,false);
                if(File.ReadAllText(Path.Combine(root,"arguments.txt"))!="/S /R") throw new Exception("Wrong installer arguments");
                // Given an installer that exits with failure, when run, then installation is not reported as completed.
                File.WriteAllText(Path.Combine(root,"fail"),"failure");
                try { await Install.Run(child,childRelease,false);throw new Exception("Failed installer accepted"); } catch(IOException) {}
            }
            // Windows denies executing a directory. Preserve the stage, file and code for a blocked helper.
            var denied=Path.Combine(root,"denied-child.exe");Directory.CreateDirectory(denied);
            try {
                await NativeTransport.CopyProcess(new ProcessStartInfo(denied),Path.Combine(root,"denied.download"),artifact,_=>{},CancellationToken.None);
                throw new Exception("Denied helper launch accepted");
            } catch(DownloadLaunchException error) {
                if(!error.Message.Contains("다운로드 모듈") || !error.Message.Contains("denied-child.exe") || !error.Message.Contains("Windows 오류 5") || !error.Message.Contains("전체 설치 파일"))
                    throw new Exception("Blocked helper guidance lost its stage, file, code or recovery action",error);
                if(File.Exists(Path.Combine(root,"denied.download"))) throw new Exception("Denied helper created output");
            }
            var destination=Path.Combine(root,"native.download");
            await NativeTransport.CopyProcess(new ProcessStartInfo(child,"/download-complete"),destination,artifact,_=>{},CancellationToken.None);
            using(var stream=File.OpenRead(destination)) Download.Verify(stream,artifact);
            try { await NativeTransport.CopyProcess(new ProcessStartInfo(child,"/download-fail"),destination,artifact,_=>{},CancellationToken.None);throw new Exception("Failed download child accepted"); } catch(IOException) {}
            try { await NativeTransport.CopyProcess(new ProcessStartInfo(child,"/download-long"),destination,artifact,_=>{},CancellationToken.None);throw new Exception("Oversized child accepted"); } catch(InvalidDataException) {}
            using(var cancellation=new CancellationTokenSource()) {
                try { await NativeTransport.CopyProcess(new ProcessStartInfo(child,"/download-hang"),destination,artifact,_=>cancellation.Cancel(),cancellation.Token);throw new Exception("Child cancellation ignored"); } catch(OperationCanceledException) {}
                var id=int.Parse(File.ReadAllText(Path.Combine(root,"child.pid")));
                try { using(var process=Process.GetProcessById(id)) { if(!process.WaitForExit(5000)) throw new Exception("Cancelled child is still alive"); } } catch(ArgumentException) {}
            }
            var helper=NativeTransport.Helper(Path.Combine(root,"helper"));
            using(var stream=new FileStream(helper,FileMode.Open,FileAccess.Write)) stream.WriteByte(0);
            try { NativeTransport.Helper(Path.GetDirectoryName(helper));throw new Exception("Tampered helper accepted"); } catch(InvalidDataException) {}
            if(File.ReadAllBytes(helper)[0]!=0) throw new Exception("Tampered helper was overwritten");
        }
    }
}
