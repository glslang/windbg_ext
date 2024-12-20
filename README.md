# WinDbg Scripts

These are personal WinDbg scripts used for various debugging tasks.

To use these scripts in WinDBG,

Ensure that the JS provider `jsprovider.dll` is loaded.

```
!load jsprovider.dll
```

## CFG valid call targets

It checks if a function is a valid call target and can be used to bypass CFG checks.

To load the script in WinDBG,

```
.scriptload C:\windbg_ext\scripts\cfg.js
```

with the usage,

```
0:032> !isvalidcalltarget "rpcrt4!NdrServerCall2"
[+] Target version is: Windows 10 Version 17763 MP (2 procs) Free x64
[+] Found CFG bitmap at: 0x7df5b9390000
[+] Found rpcrt4!NdrServerCall2 address at: 0x7ffa5faf7630
[+] Found rpcrt4!NdrServerCall2 bitmap entry: 0x28001040
[+] Found rpcrt4!NdrServerCall2 bitmap entry index: 0x6
@$isvalidcalltarget("rpcrt4!NdrServerCall2") : true
```

## PTE manipulation

It allows manipulation of PTEs to disable SMEP.

To load the script in WinDBG,

```
.scriptload C:\windbg_ext\scripts\pte.js
```

with the usage,

```
0:032> !disablesmep 0x12345678
```

## References

Makes use of template functions from https://github.com/hugsy/windbg_js_scripts.