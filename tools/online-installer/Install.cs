using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

namespace StreamRecordSetup {
    internal static class Install {
        public static void RequireAppClosed() {
            foreach(var process in Process.GetProcessesByName("stream-record")) {
                using(process) if(!process.HasExited)
                    throw new IOException("Stream-Record를 종료한 뒤 다시 시도하세요. 진행 중인 녹음을 먼저 저장해 주세요.");
            }
        }
        public static async Task Run(string file, Release release, bool interactive) {
            RequireAppClosed(); Download.PlainPath(Path.GetDirectoryName(file));
            using(var locked=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
                Download.Verify(locked,release.installer);
                var start=new ProcessStartInfo(file,interactive?"":"/S /R") { UseShellExecute=false };
                using(var process=Process.Start(start)) {
                    if(process==null) throw new IOException("설치 프로그램을 실행하지 못했습니다.");
                    await Task.Run(()=>process.WaitForExit());
                    if(process.ExitCode!=0) throw new IOException("설치가 완료되지 않았습니다. 설치 종료 코드: "+process.ExitCode);
                }
            }
        }
    }
}
