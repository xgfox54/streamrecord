using System;
using System.IO;
internal static class FixtureInstaller {
    private static int Main(string[] args) {
        var directory=Path.GetDirectoryName(typeof(FixtureInstaller).Assembly.Location);
        if(args.Length==1 && args[0].StartsWith("/download-",StringComparison.Ordinal)) {
            File.WriteAllText(Path.Combine(directory,"child.pid"),System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            using(var output=Console.OpenStandardOutput()) {
                var bytes=args[0]=="/download-long"?new byte[]{1,2,3,4,5}:new byte[]{1,2,3,4};
                output.Write(bytes,0,bytes.Length);output.Flush();
                if(args[0]=="/download-hang") System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
            }
            return args[0]=="/download-fail"?13:0;
        }
        File.WriteAllText(Path.Combine(directory,"arguments.txt"),string.Join(" ",args));
        return File.Exists(Path.Combine(directory,"fail"))?13:0;
    }
}
