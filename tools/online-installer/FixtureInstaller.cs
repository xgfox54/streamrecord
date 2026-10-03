using System;
using System.IO;
internal static class FixtureInstaller {
    private static int Main(string[] args) {
        var directory=Path.GetDirectoryName(typeof(FixtureInstaller).Assembly.Location);
        File.WriteAllText(Path.Combine(directory,"arguments.txt"),string.Join(" ",args));
        return File.Exists(Path.Combine(directory,"fail"))?13:0;
    }
}
