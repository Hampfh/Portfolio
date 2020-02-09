import { State as ConsoleState } from 'state/reducers/console'

import ClearConsole from 'functions/commands/ClearConsole'
import ExitConsole from 'functions/commands/ExitConsole'
import Help from 'functions/commands/Help'
import EjectConsole from 'functions/commands/EjectConsole'
import Ping from 'functions/commands/Ping'

export interface ReturnType {
    status?: number,
    message?: string | Array<string>,
    state?: ConsoleState
}

interface CommandArg {
    name: string,
    short?: string
}

interface CatalogeItem {
    command: string,
    out: Function
}

const cataloge: Array<CatalogeItem> = [
    { command: 'help', out: Help },
    { command: 'exit', out: ExitConsole },
    { command: 'clear', out: ClearConsole },
    { command: 'eject', out: EjectConsole },
    { command: 'ping', out: Ping }
]

export default class Interpreter {

    run(line: string, state: ConsoleState): Promise<ReturnType> {
        return new Promise(resolve => {
            let result = this.tokenize(line);
            // If token problem, return syntax message
            if (result.status !== 0) {
                resolve(result)
                return;
            }

            // Find command
            let command: CatalogeItem | null = null;
            for (let i = 0; i < cataloge.length; i++) {
                if (result.result[0] === cataloge[i].command) {
                    command = cataloge[i];
                    break;
                }
            }

            // Remove command from array, left are now only arguments
            result.result.shift()

            if (command === null) {
                resolve({ status: 1, message: "Command not recognized" });
                return;
            }

            // Check return type of out
            resolve({ ...command.out(state, result.result) });
        });
    }

    tokenize(line: string): { status: number, message?: string, result?: any} {
        let tokens = line.split(" ");
        for (let i = 0; i < tokens.length; i++) {
            let token = tokens[i];
            // If empty token, syntax error
            if (token.length <= 0)
                return { status: 1, message: "Syntax error" }
        }
        return { status: 0, result: tokens };
    }
}