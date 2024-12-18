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
        host.diagnostics.debugLog(`Could not find symbol: ${symbol}\n`);
        return;
    }

    let disassembler = host.namespace.Debugger.Utility.Code.CreateDisassembler();
    let instructions = disassembler.DisassembleFunction(address).BasicBlocks.First().Instructions;
    let loadBaseAddressInstruction = instructions.Skip(1).First();
    let baseAddress = loadBaseAddressInstruction.Operands[1].ImmediateValue;
    return hex(u64(baseAddress));
}

function calculatePteFromVa(address) {
    let pteAddress = and(shr(address, 0xc), add(shl(1, 0x24), -1));
    pteAddress = add(shl(pteAddress, 3), disassembleSymbol("nt!MiGetPteAddress"));
    return pteAddress;
}

function isUserPage(pteValue) {
    ok(`Checking if page is user 0x${hex(pteValue)}`);
    return eq(and(shr(pteValue, 6), 1), 1);
}

function showPteBits(va) {
    return calculatePteFromVa(va);
}

function markPteAsUser(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    if (isUserPage(pteValue)) {
        warn(`Page is already marked as user`);
        return;
    }

    let newPteValue = xor(pteValue, shl(1, 6));
    host.memory.writeMemoryValues(pteAddress, 1, [newPteValue], 8);
    ok(`Marked page as user`);
}

function markPteAsKernel(va) {
    let pteAddress = calculatePteFromVa(va);
    let pteValue = u64(pteAddress);
    if (!isUserPage(pteValue)) {
        warn(`Page is already marked as kernel`);
        return;
    }

    let newPteValue = and(pteValue, i64("0xFFFFFFFFFFFFFFBF"));
    host.memory.writeMemoryValues(pteAddress, 1, [newPteValue], 8);
    ok(`Marked page as kernel`);
}

function initializeScript()
{
    return [
        new host.apiVersionSupport(1, 7),
        new host.functionAlias(showPteBits, "showptebits"),
        new host.functionAlias(markPteAsUser, "markpteasuser"),
        new host.functionAlias(markPteAsKernel, "markpteaskernel")
    ];
}
