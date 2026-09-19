using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Automation;
using System.Web.Script.Serialization;
using System.IO;
using System.Threading;

// This helper only hides the App window explicitly marked by our CDP session.
class WindowHost {
    delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr p);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    static Process Allowed(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);try{var p=Process.GetProcessById((int)pid);var file=p.MainModule.FileName;if(Path.GetFileName(file).Equals("ChatGPT.exe",StringComparison.OrdinalIgnoreCase)&&file.IndexOf(@"\WindowsApps\OpenAI.",StringComparison.OrdinalIgnoreCase)>=0)return p;p.Dispose();}catch{}return null;}
    static object State(IntPtr h,Process p){return new{handle=h.ToInt64().ToString(),pid=p.Id,started=p.StartTime.ToUniversalTime().Ticks.ToString(),visible=IsWindowVisible(h),foreground=GetForegroundWindow().ToInt64().ToString()};}
    [MTAThread] static int Main(string[] args){try{
        object result;
        if(args.Length==2&&args[0]=="hide"){
            if(!args[1].StartsWith("LocalChat-"))throw new Exception("Invalid window marker");
            var matches=new List<IntPtr>();
            EnumWindows((h,p)=>{using(var process=Allowed(h)){if(process==null||!IsWindowVisible(h))return true;try{var root=AutomationElement.FromHandle(h);var doc=root.FindFirst(TreeScope.Descendants,new AndCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document),new PropertyCondition(AutomationElement.NameProperty,args[1])));if(doc!=null)matches.Add(h);}catch{}return true;}},IntPtr.Zero);
            if(matches.Count!=1)throw new Exception("Managed App window was not uniquely identified");
            var target=matches[0];using(var process=Allowed(target)){if(process==null)throw new Exception("App process changed");ShowWindow(target,0);Thread.Sleep(40);result=State(target,process);}
        }else if(args.Length==4&&args[0]=="status"){
            var target=new IntPtr(long.Parse(args[1]));using(var process=Allowed(target)){if(process==null||process.Id!=int.Parse(args[2])||process.StartTime.ToUniversalTime().Ticks.ToString()!=args[3])throw new Exception("Managed App window changed");result=State(target,process);}
        }else throw new Exception("Unsupported window operation");
        Console.WriteLine(new JavaScriptSerializer().Serialize(result));return 0;
    }catch(Exception e){Console.Error.WriteLine(e.Message);return 1;}}
}
