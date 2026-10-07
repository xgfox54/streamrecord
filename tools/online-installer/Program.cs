using System;
using System.Drawing;
using System.IO;
using System.Linq;
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
        private readonly bool afterAppExit;
        private CancellationTokenSource cancellation;
        private bool busy;
        private bool installing;
        public SetupWindow(bool verifyOnly,bool installerUi,bool afterAppExit) {
            this.verifyOnly=verifyOnly; this.installerUi=installerUi; this.afterAppExit=afterAppExit;
            cache=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"StreamRecordInstaller",release.version,Guid.NewGuid().ToString("N"));
            Text="Stream-Record 온라인 설치 · Windows 10 / 11 · CPU"; ClientSize=new Size(558,295);
            Font=new Font("맑은 고딕",10); FormBorderStyle=FormBorderStyle.FixedDialog;
            MaximizeBox=false; StartPosition=FormStartPosition.CenterScreen;
            Controls.Add(new Label { Text="Stream-Record v"+release.version,Left=24,Top=24,Width=510,Height=35,Font=new Font(Font.FontFamily,17,FontStyle.Bold) });
            Controls.Add(new Label { Text="한국어 모델 포함 · CPU 호환판 · 약 313 MB 다운로드",Left=24,Top=67,Width=510,Height=30 });
            Controls.AddRange(new Control[]{status,bar,retry,cancel});
            var license=new LinkLabel { Text="오픈소스 라이선스",Left=24,Top=235,Width=180,Height=25 };
            license.LinkClicked+=(sender,args)=>{
                using(var dialog=new Form { Text="오픈소스 라이선스",Width=720,Height=550,StartPosition=FormStartPosition.CenterParent }) {
                    var text=new TextBox { Multiline=true,ReadOnly=true,ScrollBars=ScrollBars.Both,Dock=DockStyle.Fill,Text=NativeTransport.LicenseText().Replace("\r\n","\n").Replace("\n",Environment.NewLine) };
                    dialog.Controls.Add(text);
                    dialog.Shown+=(owner,eventArgs)=>{text.Select(0,0);text.ScrollToCaret();};
                    dialog.ShowDialog(this);
                }
            };
            Controls.Add(license);
            Shown+=async(sender,args)=>await Start();
            retry.Click+=async(sender,args)=>await Start();
            cancel.Click+=(sender,args)=>{ if(busy) cancellation.Cancel(); else Close(); };
            FormClosing+=(sender,args)=>{ if(busy) { args.Cancel=true; if(!installing) cancellation.Cancel(); } };
        }
        internal void ShowFailure(Exception error) {
            status.Text="설치 진행 실패\n"+error.Message;
            var height=TextRenderer.MeasureText(status.Text,status.Font,new Size(status.Width,int.MaxValue),TextFormatFlags.WordBreak|TextFormatFlags.TextBoxControl).Height+8;
            var shift=Math.Max(65,height)-status.Height;
            status.Height+=shift;bar.Top+=shift;retry.Top+=shift;cancel.Top+=shift;
            foreach(var license in Controls.OfType<LinkLabel>()) license.Top+=shift;
            ClientSize=new Size(ClientSize.Width,ClientSize.Height+shift);
            retry.Enabled=true;
        }
        private async Task Start() {
            busy=true; installing=false; retry.Enabled=false; cancel.Enabled=true; var installed=false;
            cancellation=new CancellationTokenSource();
            try {
                if(afterAppExit) { status.Text="Stream-Record가 저장하고 종료하기를 기다리는 중입니다."; await Install.WaitForAppExit(TimeSpan.FromMinutes(2),cancellation.Token); }
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
                    status.Text="설치 완료 · Stream-Record 실행 요청을 보냈습니다."; installed=true;
                }
                bar.Value=100; cancel.Text="닫기";
            }
            catch(OperationCanceledException) { status.Text=cancellation.IsCancellationRequested?"다운로드를 취소했습니다. 다시 시도하면 검증된 조각을 재사용합니다.":"서버 응답 시간이 초과되었습니다. 다시 시도해 주세요.";retry.Enabled=true; }
            catch(Exception error) { ShowFailure(error); }
            finally { busy=false; installing=false; cancel.Enabled=true; cancellation.Dispose(); }
            if(installed && afterAppExit) { await Task.Delay(3000); Close(); }
        }
    }
    internal static class Program {
        [STAThread] private static int Main(string[] args) {
            if(!Environment.Is64BitOperatingSystem) { MessageBox.Show("Windows 64비트 PC에서 실행해 주세요.");return 1; }
            if(args.Contains("--headless-verify")) {
                try {
                    var root=Path.Combine(Path.GetTempPath(),"StreamRecordSetup-"+Guid.NewGuid().ToString("N"));
                    var file=new Download(Release.Embedded(),root,new Progress<DownloadProgress>()).Prepare(CancellationToken.None).GetAwaiter().GetResult();
                    File.WriteAllText(Path.Combine(root,"VERIFIED.txt"),file);return 0;
                } catch(Exception error) { Console.Error.WriteLine(error.Message);return 1; }
            }
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupWindow(args.Contains("--verify-only"),args.Contains("--installer-ui"),args.Contains("--after-app-exit")));return 0;
        }
    }
}
