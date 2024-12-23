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
const xor = (x, y) => expr(x, `^`, y);
const add = (x, y) => expr(x, `+`, y);
const mod = (x, y) => expr(x, `%`, y);
const eq = (x, y) => pop(system(`dx ${x} == ${y}`)) === `true` ? true : false
const neq = (x, y) => pop(system(`dx ${x} != ${y}`)) === `true` ? true : false
const IsArm64 = () => pop(system(".effmach")).toLowerCase().includes("arm64");

function getWindowsVersion() {
    let verInfo = system("vertarget").First();
    return verInfo;
}

function getModuleSymbolAddress(symbol)
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

function disassembleSymbol(symbol) {
    let address = getModuleSymbolAddress(symbol);
    if (address === null) {
        log(`Could not find symbol: ${symbol}\n`);
        return;
    }

    let windowsVersion = getWindowsVersion();
    let is23H2 = windowsVersion.includes("22621");
    let skip = is23H2 ? 2 : 1;

    let disassembler = host.namespace.Debugger.Utility.Code.CreateDisassembler();
    let instructions = disassembler.DisassembleFunction(address).BasicBlocks.First().Instructions;
    let loadBaseAddressInstruction = instructions.Skip(skip).First();
    let baseAddress = loadBaseAddressInstruction.Operands[1].ImmediateValue;
    return hex(u64(baseAddress));
}

function calculatePteFromVa(address) {
    let pteAddress = and(shr(address, 0xc), add(shl(1, 0x24), -1));
    pteAddress = add(shl(pteAddress, 3), disassembleSymbol("nt!MiGetPteAddress"));
    return pteAddress;
}

function isUserPage(pteValue) {
    let userBit = IsArm64() ? 6 : 2;
    return eq(and(shr(pteValue, userBit), 1), 1);
}

function isUserNoExecute(pteValue) {
    return eq(and(shr(pteValue, 54), 1), 1);
}

function isPrivilegedNoExecute(pteValue) {
    return eq(and(shr(pteValue, 53), 1), 1);
}

function showPteBits(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    ok(`Checking page 0x${hex(pteValue)}...`);
    if (isUserPage(pteValue)) {
        ok(`PTE: 0x${hex(pteValue)} is user`);
    } else {
        ok(`PTE: 0x${hex(pteValue)} is kernel`);
    }
    if (IsArm64()) {
        if (isUserNoExecute(pteValue)) {
            ok(`PTE: 0x${hex(pteValue)} is user no execute`);
        } else {
            ok(`PTE: 0x${hex(pteValue)} is user execute`);
        }
        if (isPrivilegedNoExecute(pteValue)) {
            ok(`PTE: 0x${hex(pteValue)} is privileged no execute`);
        } else {
            ok(`PTE: 0x${hex(pteValue)} is privileged execute`);
        }
    }
}

function markPteAsUser(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    ok(`Checking page 0x${hex(pteValue)}...`);
    if (isUserPage(pteValue)) {
        warn(`Page is already marked as user`);
        return;
    }
    let userBit = IsArm64() ? 6 : 2;
    let newPteValue = xor(pteValue, shl(1, userBit));
    host.memory.writeMemoryValues(pteAddress, 1, [newPteValue], 8);
    ok(`Marked page as user`);
}

function markPteAsKernel(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    ok(`Checking page 0x${hex(pteValue)}...`);
    if (!isUserPage(pteValue)) {
        warn(`Page is already marked as kernel`);
        return;
    }
    let mask = IsArm64() ? i64("0xFFFFFFFFFFFFFFBF") : i64("0xFFFFFFFFFFFFFFFB");
    let newPteValue = and(pteValue, mask);
    host.memory.writeMemoryValues(pteAddress, 1, [newPteValue], 8);
    ok(`Marked page as kernel`);
}

function markPteAsPrivilegedExecute(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    ok(`Checking page 0x${hex(pteValue)}...`);
    if (!isPrivilegedNoExecute(pteValue)) {
        warn(`Page is already marked as privileged execute`);
        return;
    }
    let newPteValue = and(pteValue, i64("0xFF8FFFFFFFFFFFFF"));
    host.memory.writeMemoryValues(pteAddress, 1, [newPteValue], 8);
    ok(`Marked page as privileged execute`);
}

function disableSmep(va) {
    if (IsArm64()) {
        markPteAsKernel(va);
        markPteAsPrivilegedExecute(va);
    } else {
        markPteAsKernel(va);
    }
    ok(`Disabled SMEP`);
}

function initializeScript()
{
    return [
        new host.apiVersionSupport(1, 7),
        new host.functionAlias(showPteBits, "showptebits"),
        new host.functionAlias(markPteAsUser, "markpteasuser"),
        new host.functionAlias(markPteAsKernel, "markpteaskernel"),
        new host.functionAlias(IsArm64, "isarm64"),
        new host.functionAlias(disableSmep, "disablesmep")
    ];
}
