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
        private static int Main() {
            try { Run().GetAwaiter().GetResult(); Console.WriteLine("PASS: 12 checks (7 installer checks; native pipe success, failed exit, oversized output, child cancellation, helper tampering)");return 0; }
            catch(Exception error) { Console.Error.WriteLine(error);return 1; }
        }
        private static async Task Run() {
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
            var child=Path.Combine(root,"child.exe");File.Copy("work/fixture-installer.exe",child);
            var childArtifact=Sample(File.ReadAllBytes(child));childArtifact.name="child.exe";
            var childRelease=new Release { installer=childArtifact };
            await Install.Run(child,childRelease,false);
            if(File.ReadAllText(Path.Combine(root,"arguments.txt"))!="/S /R") throw new Exception("Wrong installer arguments");
            // Given an installer that exits with failure, when run, then installation is not reported as completed.
            File.WriteAllText(Path.Combine(root,"fail"),"failure");
            try { await Install.Run(child,childRelease,false);throw new Exception("Failed installer accepted"); } catch(IOException) {}
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
