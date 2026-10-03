using System;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]

namespace StreamRecordSetup {
    internal sealed class SetupWindow : Form {
        private readonly Label status=new Label { Left=24,Top=105,Width=510,Height=65 };
        private readonly ProgressBar bar=new ProgressBar { Left=24,Top=180,Width=510,Height=25 };
        private readonly Button retry=new Button { Text="다시 시도",Left=325,Top=230,Width=100,Enabled=false };
        private readonly Button cancel=new Button { Text="취소",Left=434,Top=230,Width=100 };
        private readonly Release release=Release.Embedded();
        private readonly string cache;
        private readonly bool verifyOnly;
        private readonly bool installerUi;
        private CancellationTokenSource cancellation;
        private bool busy;
        private bool installing;
        public SetupWindow(bool verifyOnly,bool installerUi) {
            this.verifyOnly=verifyOnly; this.installerUi=installerUi;
            cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StreamRecordInstaller",release.version,Guid.NewGuid().ToString("N"));
            Text="Stream-Record 온라인 설치 · CPU"; ClientSize=new Size(558,295);
            Font=new Font("맑은 고딕",10); FormBorderStyle=FormBorderStyle.FixedDialog;
            MaximizeBox=false; StartPosition=FormStartPosition.CenterScreen;
            Controls.Add(new Label { Text="Stream-Record v"+release.version,Left=24,Top=24,Width=510,Height=35,Font=new Font(Font.FontFamily,17,FontStyle.Bold) });
            Controls.Add(new Label { Text="한국어 모델 포함 · CPU 호환판 · 약 313 MB 다운로드",Left=24,Top=67,Width=510,Height=30 });
            Controls.AddRange(new Control[]{status,bar,retry,cancel});
            Shown+=async(sender,args)=>await Start();
            retry.Click+=async(sender,args)=>await Start();
            cancel.Click+=(sender,args)=>{ if(busy) cancellation.Cancel(); else Close(); };
            FormClosing+=(sender,args)=>{ if(busy) { args.Cancel=true; if(!installing) cancellation.Cancel(); } };
        }
        private async Task Start() {
            busy=true; installing=false; retry.Enabled=false; cancel.Enabled=true;
            cancellation=new CancellationTokenSource();
            try {
                if(!verifyOnly && !installerUi) Install.RequireAppClosed();
                var progress=new Progress<DownloadProgress>(p=>{
                    if(!busy || installing) return;
                    bar.Value=(int)Math.Min(100,p.Bytes*100/p.Total);
                    status.Text=p.Stage+" · "+(p.Bytes/1048576)+" / "+(p.Total/1048576)+" MB";
                });
                status.Text="GitLab에서 설치파일을 내려받고 있습니다.";
                var file=await new Download(release,cache,progress).Prepare(cancellation.Token);
                cancellation.Token.ThrowIfCancellationRequested();
                if(verifyOnly) status.Text="다운로드·SHA-256 검증 완료\n설치 실행 생략 (검증 모드)";
                else {
                    installing=true; cancel.Enabled=false; status.Text="설치 중입니다. 완료되면 Stream-Record가 실행됩니다.";
                    await Install.Run(file,release,installerUi);
                    status.Text="설치 완료 · Stream-Record 실행 요청을 보냈습니다.";
                }
                bar.Value=100; cancel.Text="닫기";
            }
            catch(OperationCanceledException) { status.Text=cancellation.IsCancellationRequested?"다운로드를 취소했습니다. 다시 시도하면 검증된 조각을 재사용합니다.":"서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.";retry.Enabled=true; }
            catch(Exception error) { var detail=error;while(detail.InnerException!=null) detail=detail.InnerException;status.Text="설치 진행 실패\n"+detail.Message;retry.Enabled=true; }
            finally { busy=false; installing=false; cancel.Enabled=true; cancellation.Dispose(); }
        }
    }
    internal static class Program {
        [STAThread] private static int Main(string[] args) {
            AppContext.SetSwitch("Switch.System.Net.DontEnableSystemDefaultTlsVersions",false);
            AppContext.SetSwitch("Switch.System.Net.DontEnableSchUseStrongCrypto",false);
            ServicePointManager.SecurityProtocol=(SecurityProtocolType)0;
            if(!Environment.Is64BitOperatingSystem) { MessageBox.Show("Windows 64비트 PC에서 실행해 주세요.");return 1; }
            if(args.Contains("--headless-verify")) {
                try {
                    var root=Path.Combine(Path.GetTempPath(),"StreamRecordSetup-"+Guid.NewGuid().ToString("N"));
                    var file=new Download(Release.Embedded(),root,new Progress<DownloadProgress>()).Prepare(CancellationToken.None).GetAwaiter().GetResult();
                    File.WriteAllText(Path.Combine(root,"VERIFIED.txt"),file);return 0;
                } catch(Exception error) { Console.Error.WriteLine(error.Message);return 1; }
            }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWindow(args.Contains("--verify-only"),args.Contains("--installer-ui")));return 0;
        }
    }
}
