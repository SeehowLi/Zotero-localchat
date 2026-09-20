using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// A Start-menu entry for the existing App. It never quits an existing App instance.
class ChatGPTLauncher {
    static readonly string Arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=23129";
    [STAThread] static int Main(string[] args) {
        bool inspect = args.Length == 1 && args[0] == "--inspect";
        try {
            if (args.Length > 0 && !inspect) throw new Exception("Unsupported launcher argument");
            string family = File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app-family.txt"), Encoding.UTF8).Trim();
            if (!Regex.IsMatch(family, @"\AOpenAI\.(Codex|ChatGPT)_[A-Za-z0-9]+\z")) throw new Exception("Invalid App package family");
            string command = "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; $p=Get-AppxPackage | Where-Object PackageFamilyName -eq '" + family + "' | Select-Object -First 1; if($p){[Console]::Write($p.InstallLocation)}";
            var probeInfo = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"), "-NoProfile -NonInteractive -Command \"" + command + "\"");
            probeInfo.UseShellExecute = false; probeInfo.CreateNoWindow = true;
            probeInfo.RedirectStandardOutput = true; probeInfo.RedirectStandardError = true; probeInfo.StandardOutputEncoding = Encoding.UTF8;
            string folder;
            using (var probe = Process.Start(probeInfo)) {
                if (!probe.WaitForExit(15000)) { probe.Kill(); throw new Exception("App lookup timed out"); }
                folder = probe.StandardOutput.ReadToEnd().Trim();
                if (probe.ExitCode != 0 || folder.Length == 0) throw new Exception("The installed ChatGPT App was not found");
            }
            string exe = Path.Combine(folder, @"app\ChatGPT.exe");
            if (!File.Exists(exe)) throw new Exception("The installed App layout has changed; update the Local Chat launcher");
            if (inspect) { Console.WriteLine(new JavaScriptSerializer().Serialize(new { executable = exe, arguments = Arguments, family = family })); return 0; }
            Process.Start(new ProcessStartInfo(exe, Arguments) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) });
            return 0;
        } catch (Exception e) {
            if (inspect) Console.Error.WriteLine(e.Message);
            else MessageBox.Show("无法打开 ChatGPT：" + e.Message, "ChatGPT · Local Chat", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
