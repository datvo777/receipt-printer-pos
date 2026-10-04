# Gửi file nhị phân (lệnh ESC/POS) thẳng ra máy in trên Windows, không qua driver vẽ lại.
param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$File
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static string SendBytes(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      return "Không mở được máy in '" + printerName + "' (mã lỗi " + Marshal.GetLastWin32Error() + "). Kiểm tra tên máy in trong Cài đặt.";
    }
    string error = null;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "Tiem Bill";
    di.pDataType = "RAW";
    IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
      if (!StartDocPrinter(hPrinter, 1, di)) {
        error = "StartDocPrinter lỗi " + Marshal.GetLastWin32Error();
      } else {
        if (!StartPagePrinter(hPrinter)) {
          error = "StartPagePrinter lỗi " + Marshal.GetLastWin32Error();
        } else {
          int written;
          if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written) || written != bytes.Length) {
            error = "Gửi dữ liệu ra máy in lỗi " + Marshal.GetLastWin32Error();
          }
          EndPagePrinter(hPrinter);
        }
        EndDocPrinter(hPrinter);
      }
    } finally {
      Marshal.FreeCoTaskMem(pUnmanaged);
      ClosePrinter(hPrinter);
    }
    return error;
  }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($File)
$err = [RawPrinterHelper]::SendBytes($Printer, $bytes)
if ($err) {
  [Console]::Error.WriteLine($err)
  exit 1
}
