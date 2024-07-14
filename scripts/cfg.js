///
/// <reference path="../.vscode/providers/JSProvider.d.ts" />
///
/// @ts-check
///
"use strict";

const log = x => host.diagnostics.debugLog(`${x}\n`);
const ok = x => log(`[+] ${x}`);
const warn = x => log(`[!] ${x}`);
const err = x => log(`[-] ${x}`);
const hex = x => x.toString(16);
const i64 = (x, b=16) => host.parseInt64(x, b);
const system = x => host.namespace.Debugger.Utility.Control.ExecuteCommand(x);
const u8 = x => host.memory.readMemoryValues(x, 1, 1)[0];
const u16 = x => host.memory.readMemoryValues(x, 1, 2)[0];
const u32 = x => host.memory.readMemoryValues(x, 1, 4)[0];
const u64 = x => host.memory.readMemoryValues(x, 1, 8)[0];
const pop = x => x.First().split(/[ \t]/).pop()
const dq = x => i64(pop(system(`dq ${x}`)))
const expr = (x, op, y) => i64(pop(system(`? ${hex(x)} ${op} ${hex(y)}`)));
const shr = (x, y) => expr(x, `>>`, y);
const shl = (x, y) => expr(x, `<<`, y);
const and = (x, y) => expr(x, `&`, y);
const add = (x, y) => expr(x, `+`, y);
const mod = (x, y) => expr(x, `%`, y);
const neq = (x, y) => pop(system(`dx ${x} != ${y}`)) === `true` ? true : false


function curthread() { return host.namespace.Debugger.State.DebuggerVariables.curthread; }
function curprocess() { return host.namespace.Debugger.State.DebuggerVariables.curprocess; }
function cursession() { return host.namespace.Debugger.State.DebuggerVariables.cursession; }
function ptrsize() { return host.namespace.Debugger.State.PseudoRegisters.General.ptrsize; }
function pagesize() { return host.namespace.Debugger.State.PseudoRegisters.General.pagesize; }
function IsX64() { return ptrsize() === 8; }
function IsKd() { return host.namespace.Debugger.Sessions.First().Attributes.Target.IsKernelTarget === true; }
function $(r) { return IsKd() ? host.namespace.Debugger.State.DebuggerVariables.curthread.Registers.User[r] || host.namespace.Debugger.State.DebuggerVariables.curthread.Registers.Kernel[r] : host.namespace.Debugger.State.DebuggerVariables.curthread.Registers.User[r]; }
function GetSymbolFromAddress(x) { return system(`.printf "%y", ${hex(x)}`).First(); }
function poi(x) { return IsX64() ? u64(x) : u32(x); }
function assert(condition, message) { if (!condition) { throw new Error(`Assertion failed: ${message}`); } }

function GetModuleSymbolAddress(symbol)
{
    if (symbol.indexOf('!') === -1)
    {
        let defaultModules = ["ntdll", "kernel32", "kernelbase"];
        for (let module of defaultModules)
        {
            let address = host.getModuleSymbolAddress(module, symbol);
            if (address != null) {
                ok(`Found ${symbol} module: ${module}`);
                return address;
            }
        }
        return null;
    }

    let parts = symbol.split('!');
    return host.getModuleSymbolAddress(parts[0], parts[1]);
}

function GetTargetVersion()
{
    let target = system(`vertarget`).First().split(/[\n]/)[0];
    let version = target.split(" ")[3];
    return [target, version];
}

function GetCFGBitmapOffset(targetVersion)
{
    if (targetVersion !== `17763`) {
        warn(`Assuming CFG bitmap offset is: 0xb0`);
    }
    return 0xb0;
}

function IsValidCallTarget(functionName)
{
    let targetVersion = GetTargetVersion();
    ok(`Target version is: ${targetVersion[0]}`);
    let ldrSystemDllInitBlockBase = GetModuleSymbolAddress("ntdll!LdrSystemDllInitBlock");
    let cfgBitmap = poi(add(ldrSystemDllInitBlockBase, GetCFGBitmapOffset(targetVersion[1])));
    ok(`Found CFG bitmap at: 0x${hex(cfgBitmap)}`);
    let functionAddress = GetModuleSymbolAddress(functionName);
    assert(functionAddress != null, `${functionName} address not found`);
    ok(`Found ${functionName} address at: ${functionAddress}`);
    let bitmapEntry = dq(`${hex(cfgBitmap)} + (${hex(functionAddress)} >> 9) * 8 L1`);
    ok(`Found ${functionName} bitmap entry: 0x${hex(bitmapEntry)}`);
    let bitmapEntryIndex = mod(shr(functionAddress, 3), 0x40);
    ok(`Found ${functionName} bitmap entry index: 0x${hex(bitmapEntryIndex)}`);
    return neq(and(bitmapEntry, shl(1, bitmapEntryIndex)), 0);
}

function initializeScript()
{
    return [
        new host.apiVersionSupport(1, 7),
        new host.functionAlias(IsValidCallTarget, "isvalidcalltarget")
    ];
}
