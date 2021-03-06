import React, { Component, createRef } from 'react'
import Interpreter from 'functions/Interpreter'

import styles from './Console.module.scss'
import { Line, LineType, OutputMode, State as StateForComponent } from 'state/reducers/console'
import { connect } from 'react-redux'
import { ISetNewline, setAll, setNewline, windowVisible } from 'state/actions/console'
import {
	ISetChatActive,
	setChatActive,
	ISetChatName,
	setChatName,
	IAddChatMessage,
	addChatMessage,
	setChatState,
	ISetChatState
} from "state/actions/chat"
import { IChatMessage, IChatState } from 'state/reducers/chat'
import SocketManager, { socketEmit } from '../SocketManager'
import Moment from "moment"

export class Console extends Component<PropsForComponent, StateForComponent> {
	currentIndex = 1;
	cursorOnTime = 600;
	cursorOffTime = 500;

	currentLine: React.RefObject<HTMLInputElement>;
	console: React.RefObject<HTMLElement>;
	interpreter: Interpreter;
	constructor(props: PropsForComponent) {
		super(props);

		this.interpreter = new Interpreter();

		this.currentLine = createRef();
		this.console = createRef();

		this.addCharToCurrentLine = this.addCharToCurrentLine.bind(this);
		this.removeLastCharFromCurrentLine = this.removeLastCharFromCurrentLine.bind(this);
		this._handleKeyCode = this._handleKeyCode.bind(this);
		this._handleKey = this._handleKey.bind(this);
		this.toggleCursor = this.toggleCursor.bind(this);
		this.finishLine = this.finishLine.bind(this);
		this.typeRecursive = this.typeRecursive.bind(this);
	}

	async componentDidUpdate() {
		if (this.props.console.lineWasAdded && this.console.current !== null) {
			this.console.current.scrollTo({
				top: this.console.current?.scrollHeight,
				behavior: 'smooth'
			});
			this.props.setNewline(false)
		}
	}

	async componentDidMount() {

		// Clear lines on mount
		let newState = this.props.console;
		newState.lines = [];
		newState.cursor.active = false;
		newState.cursor.typing = false;
		if (newState.cursor.interval !== null)
			clearTimeout(newState.cursor.interval);
		this.props.setAll(newState);

		// Load already existing text
		if (this.props.onLoadMessage !== undefined) {
			let batch = this.props.onLoadMessage;
			for (let i = 0; i < batch.length; i++) {
				let lines = this.props.onLoadMessage[i];
				await this.output(lines.text, lines.type, lines.mode);
			}
		}
		if (this.props.interactive !== undefined && this.props.interactive === true) {
			this.startInputLine();

			// Only set interval on initial page load
			if (this.props.console.cursor.interval === null)
				this.toggleCursor();
		}
	}

	typeLine(line: string | string[], type: LineType = LineType.info, lineDelay: number, index: number | undefined = undefined) {
		return new Promise(resolve => {
			const newState = { ...this.props.console }
			if (Array.isArray(line) && index !== undefined) {
				newState.lines.push({ id: this.currentIndex++, type, text: line[index] });

				// Re-enable typing for user
				newState.cursor.typing = false;
				newState.lineWasAdded = true;
				this.props.setAll(newState);
				index++

				setTimeout(async () => {
					if (index !== undefined && index < line.length)
						await this.typeLine(line, type, lineDelay, index)
					resolve()
				}, lineDelay)

			} else {
				newState.lines.push({ id: this.currentIndex++, type, text: line as string });
				// Re-enable typing for user
				newState.cursor.typing = false;
				newState.lineWasAdded = true;
				this.props.setAll(newState);
				resolve()
			}
		})
	}

	typeRecursive(index: number | Index, data: string | Array<string>, type: LineType = LineType.info, method: OutputMode = OutputMode.typing) {
		const LineDelay = {
			char: 0,
			space: 0,
			newLine: 300,
			loadingChar: 0
		}
		const TypingDelay = {
			char: 40,
			space: 15,
			newLine: 150,
			loadingChar: 500
		}

		// Typing method
		let DefaultDelays = (method === OutputMode.typing ? TypingDelay : LineDelay);

		// Get next char
		let nextChar: string = "";
		if (Array.isArray(data) && typeof index !== 'number') {
			if (index.innerIndex >= data[index.outerIndex].length)
				nextChar = "\n";
			else
				nextChar = (data[index.outerIndex][index.innerIndex]);
		}
		else
			nextChar = (data[index as number]);

		// Calculate the current delay
		let thisDelay = DefaultDelays.char;
		switch (nextChar) {
			case ' ':
				thisDelay = DefaultDelays.space;
				break;
			case '\n':
				thisDelay = DefaultDelays.newLine;
				break;
			case '■':
				thisDelay = DefaultDelays.loadingChar;
				break;
		}

		return new Promise(resolve => {
			// Multiple lines
			if (Array.isArray(data)) {
				setTimeout(async () => {
					index = index as Index;

					if (index.innerIndex < data[index.outerIndex].length) {
						this.addCharToCurrentLine(data[index.outerIndex][index.innerIndex], type);
						index.innerIndex++;
					} else {
						index.innerIndex = 0;
						index.outerIndex++;
						// Don't create newline on last line
						if (index.outerIndex < data.length) {
							this.finishLine();
							this.output("", type);
						}
					}

					if (index.outerIndex < data.length)
						await this.typeRecursive(index, data, type, method);

					resolve();
				}, thisDelay);
			} else { // Only one line
				setTimeout(async () => {
					index = index as number;

					if (data[index] !== undefined)
						this.addCharToCurrentLine(data[index], type);
					if (index < data.length)
						await this.typeRecursive(++index, data, type, method);

					// Only the first instance of the recursion will create a newline
					if (index === 0) {
						this.finishLine();
						this.output("", type);
					}
					resolve();
				}, thisDelay);
			}
		})
	}

	output(text: string | Array<string> = "", type: LineType = LineType.info, method: OutputMode = OutputMode.default, preprendCurrentLine?: boolean) {
		return new Promise(async resolve => {

			let tempState = { ...this.props.console };
			tempState.cursor.typing = true;
			this.props.setAll(tempState);

			let newState = { ...this.props.console };
			// Create new empty line
			if (typeof text === 'string' && text.length === 0 && newState.lines[newState.lines.length - 1].text.length > 0)
				newState.lines.push({ id: this.currentIndex++, type, text: "" })

			// Default output method
			else if (method === OutputMode.default) {
				if (Array.isArray(text)) {
					for (let i = 0; i < text.length; i++) {
						newState.lines.push({ id: this.currentIndex++, type, text: text[i] })
					}
				} else {
					if (preprendCurrentLine) {
						const activeLine = newState.lines[newState.lines.length - 1].text
						newState.lines.splice(newState.lines.length - 1, 1)
						newState.lines.push({ id: this.currentIndex++, type, text });
						newState.lines.push({ id: this.currentIndex++, type: LineType.input, text: activeLine })
					}
					else
						newState.lines.push({ id: this.currentIndex++, type, text });
				}

				// Re-enable typing for user
				tempState = { ...this.props.console }
				tempState.cursor.typing = false;
				this.props.setAll(tempState);
			}

			// Typing output method
			else if (method === OutputMode.typing || method === OutputMode.line) {
				this.finishLine();
				// Add new empty line
				newState.lines.push({ id: this.currentIndex++, type, text: "" });
				if (method === OutputMode.line) {
					await this.typeLine(text, type, 900, 0)
				} else
					await this.typeRecursive((Array.isArray(text) ? { innerIndex: 0, outerIndex: 0 } : 0), text, type, method);

				// Re-enable typing for user
				tempState = { ...this.props.console }
				tempState.cursor.typing = false;
				this.props.setAll(tempState);
			}
			newState.lineWasAdded = true;
			this.props.setAll(newState);
			resolve();
		});
	}

	getCurrentLine() {
		return this.props.console.lines[this.props.console.lines.length - 1];
	}

	removeLastCharFromCurrentLine() {
		let newState = { ...this.props.console };
		let targetLine = this.getCurrentLine();
		if (targetLine === undefined || targetLine.text.length <= 0)
			return;

		if (this.props.console.cursor.active) {
			targetLine.text = targetLine.text.substr(0, targetLine.text.length - 2);
			targetLine.text += this.props.console.cursor.char;
		} else {
			targetLine.text = targetLine.text.substr(0, targetLine.text.length - 1);
		}
		newState.lines[newState.lines.length - 1] = targetLine;
		this.props.setAll(newState);
	}

	addCharToCurrentLine(char: string, type: LineType = LineType.info) {
		let newState = { ...this.props.console };
		if (newState.lines.length <= 0)
			newState.lines.push({ id: this.currentIndex++, type, text: char });
		else {
			if (newState.cursor.active) {
				let newLine = newState.lines[newState.lines.length - 1].text.substr(0, newState.lines[newState.lines.length - 1].text.length - 1);
				newLine += char;
				newLine += this.props.console.cursor.char;
				newState.lines[newState.lines.length - 1].text = newLine;
			} else {
				newState.lines[newState.lines.length - 1].text += char;
			}
		}
		this.props.setAll(newState);
	}

	startInputLine() {
		// Execute line
		let newState = { ...this.props.console };
		// Reset cursor
		newState.cursor.active = false;
		// Add a new empty line
		newState.lines.push({ id: this.currentIndex++, type: LineType.input, text: "" });
		this.toggleCursor();
		newState.lineWasAdded = true;
		this.props.setAll(newState);
	}

	finishLine(): Line {
		// Execute line
		let newState = { ...this.props.console };
		let lines = [...newState.lines];

		// Remove cursor if it is active
		if (this.props.console.cursor.active) {
			let currentLine = this.getCurrentLine();
			lines.pop();
			currentLine.text = currentLine.text.substr(0, currentLine.text.length - 1);
			lines.push(currentLine);
		}

		// If current line is empty, add dummy character to it
		if (newState.lines.length > 0 && newState.lines[newState.lines.length - 1].text.length <= 0)
			newState.lines[newState.lines.length - 1].text = "";

		clearInterval(newState.cursor.interval as NodeJS.Timeout);

		// Reset cursor
		newState.cursor.active = false;

		this.props.setAll(newState);
		return this.getCurrentLine();
	}

	async _handleKey(event: any) {
		if (!!!this.props.console.cursor.typing) {
			let newEvent = { ...this.props.console };
			switch (event.key) {
				case 'Enter':
					if (this.props.chat.active) {

						// If empty line then don't let user create message
						const lastLine = this.props.console.lines[this.props.console.lines.length - 1]
						if ((lastLine.text.length === 0 ||
							(lastLine.text.length === 1 && lastLine.text[lastLine.text.length - 1] === this.props.console.cursor.char))) {
							return
						}

						let Line = this.finishLine();
						this.props.addChatMessage({
							user: `[You]`,
							message: Line.text,
							timestamp: Moment().toDate()
						})
						socketEmit("message", {
							user: this.props.chat.chatName ?? "Anonymous",
							message: Line.text,
							timestamp: Moment().toDate()
						} as IChatMessage)
						this.startInputLine()
						setTimeout(() => {
							this.props.setNewline(true)
						}, 0)
					} else { // Default mode
						let Line = this.finishLine();
						let result = await this.interpreter.run(Line.text, newEvent, this.props.chat);

						if (result.state !== undefined)
							this.props.setAll(result.state);
						if (result.chatState !== undefined)
							this.props.setChatState(result.chatState)

						if (result.status !== 0)
							await this.output(result.message as string, LineType.error);
						else if (result.status === 0 && result.message !== undefined)
							await this.output(result.message, LineType.info);
						this.startInputLine();
						this.props.setAll({ ...this.props.console, lineWasAdded: true });
					}
					break;
				case ' ':
					event.preventDefault();
					this.addCharToCurrentLine(event.key);
					break;
				default:
					this.addCharToCurrentLine(event.key);
			}
			this.props.setAll(newEvent);
		}
	}

	_handleKeyCode(event: any) {
		if (event.keyCode === 8) {
			event.preventDefault();
			this.removeLastCharFromCurrentLine();
		}
	}

	toggleCursor() {
		let newState = { ...this.props.console };
		if (newState.cursor.active) {
			let targetLine = this.getCurrentLine();
			if (targetLine === undefined || targetLine.text.length <= 0)
				return;

			targetLine.text = targetLine.text.substr(0, targetLine.text.length - 1);
			newState.lines[newState.lines.length - 1] = targetLine;
			newState.cursor.active = false;
			newState.cursor.interval = setTimeout(this.toggleCursor, this.cursorOffTime);
		} else {
			this.addCharToCurrentLine(this.props.console.cursor.char);
			newState.cursor.active = true;
			newState.cursor.interval = setTimeout(this.toggleCursor, this.cursorOnTime);
		}
		this.props.setAll(newState);
	}

	render() {
		return (
			<>
				{this.props.chat.active ?
					<>
						<SocketManager subscribeTo="message" callback={async (data: IChatMessage) => {
							await this.output(`[${data.user}]: ` + data.message, LineType.info, OutputMode.default, true);
							this.props.addChatMessage(data)
						}} />
						<SocketManager subscribeTo="enterchat" callback={async (data: { user: string }) => {
							await this.output(`${data.user} connected to the chat`, LineType.info, OutputMode.default, true);
						}} />
					</>
					: null}
				<section ref={this.console} className={styles.console} tabIndex={0} onKeyDown={this._handleKeyCode} onKeyPress={this._handleKey}>
					{this.props.console.lines.map(line => {

						if (line.type === LineType.input) {
							return (
								<div key={line.id} className={styles.line}>
									{this.props.chat.active ?
										<span className={styles.userPrefix}>[You]:</span> :
										<span className={styles.userPrefix}>server@user:~$</span>
									}
									<p className={styles.consoleInput}>{line.text}</p>
								</div>
							)
						}
						else {
							return (
								<div key={line.id} className={styles.line}>
									<p className={styles.consoleInput + " " + styles[line.type]}>{line.text}</p>
								</div>
							)
						}
					})}
				</section>
			</>
		)
	}
}

interface Index {
	outerIndex: number,
	innerIndex: number
}

export interface OutputLine {
	type: LineType,
	mode: OutputMode,
	text: Array<string>
}

interface PropsForComponent {
	onLoadMessage?: Array<OutputLine>
	interactive?: boolean,
	chat: IChatState,
	console: StateForComponent,
	windowVisible: Function,
	setAll: Function,

	setChatActive: ISetChatActive,
	setChatName: ISetChatName,
	addChatMessage: IAddChatMessage,
	setChatState: ISetChatState,
	setNewline: ISetNewline
}

const reduxSelect = (state: any) => {
	return {
		chat: state.chat,
		console: state.console
	}
}

const reduxDispatch = () => {
	return {
		setAll,
		windowVisible,
		setChatActive,
		setChatName,
		addChatMessage,
		setChatState,
		setNewline
	}
}

export default connect(reduxSelect, reduxDispatch())(Console);
