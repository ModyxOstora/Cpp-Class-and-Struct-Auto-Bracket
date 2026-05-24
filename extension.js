const vscode = require('vscode');

// Tracks positions where we inserted {}; so backspace can delete all of it
const inlineBracketPositions = new Map();

function positionKey(uri, position) {
	return `${uri}:${position.line}:${position.character}`;
}

function getIndentUnit(editor) {
	const insertSpaces = editor.options.insertSpaces;
	const tabSize = editor.options.tabSize;
	if (insertSpaces) {
		return ' '.repeat(typeof tabSize === 'number' ? tabSize : 4);
	}
	return '\t';
}

// The single source of truth:
// Scan upward from cursor, collect lines, join them, and check if they form
// a valid unclosed class/struct/enum declaration.
// Returns { declarationIndent, isOnDeclarationLine, currentLineIsEmpty } or null.
function findUnclosedDeclaration(document, cursor) {
	const currentLineNum = cursor.line;
	const lines = [];

	// Collect lines from cursor upward until we find the declaration keyword
	for (let i = currentLineNum; i >= 0; i--) {
		const line = document.lineAt(i).text;
		lines.unshift(line);

		// Once we have the keyword we have enough — stop collecting
		if (/(class|struct|enum)\s+\w+/.test(line)) break;

		// If we hit a line that clearly can't be part of a declaration → stop
		if (i < currentLineNum && line.trim() !== '' &&
			!/(class|struct|enum)\s+\w+/.test(line) &&
			!/^\s*:/.test(line) &&
			!/^\s*(public|protected|private)\s+/.test(line) &&
			!/,\s*$/.test(line)) {
			return null;
		}
	}

	// Join all collected lines into one string and normalize whitespace
	const joined = lines.join(' ').replace(/\s+/g, ' ').trim();

	// Simple validation — just check the three rules:
	// 1. Must contain a declaration keyword followed by a name
	// 2. Must not end with ; (forward declaration)
	// 3. Must not have { AFTER the keyword (already opened)
	const keywordMatch = joined.search(/(class|struct|enum)\s+\w+/);
	if (keywordMatch === -1) return null;
	if (joined.trim().endsWith(';')) return null;
	const braceAfterKeyword = joined.indexOf('{', keywordMatch);
	if (braceAfterKeyword !== -1) return null;

	// Get the indent from the line that has the declaration keyword
	const declarationLine = lines.find(l => /(class|struct|enum)\s+\w+/.test(l));
	const indentMatch = declarationLine ? declarationLine.match(/^(\s*)/) : null;
	const declarationIndent = indentMatch ? indentMatch[1] : '';

	// Is the cursor on the declaration line itself or below it?
	const currentLineText = document.lineAt(currentLineNum).text;
	const isOnDeclarationLine = /(class|struct|enum)\s+\w+/.test(currentLineText);

	// Is the current line empty? (determines replace vs insert for Allman style)
	const currentLineIsEmpty = currentLineText.trim() === '';

	return { declarationIndent, isOnDeclarationLine, currentLineIsEmpty };
}

function activate(context) {

	// ── Toggle inline mode command ───────────────────────────────────────────
	const toggleCommand = vscode.commands.registerCommand('cpp-class-bracket.toggleInlineMode', () => {
		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const current = config.get('inlineMode', false);
		config.update('inlineMode', !current, vscode.ConfigurationTarget.Global).then(() => {
			vscode.window.showInformationMessage(
				`C++ Auto Bracket: Inline mode ${!current ? 'ON ✅' : 'OFF ❌'}`
			);
		});
	});

	// ── Main Shift+[ command ─────────────────────────────────────────────────
	const bracketCommand = vscode.commands.registerCommand('cpp-class-bracket.insertClassBracket', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const document = editor.document;
		const selections = editor.selections;

		if (selections.some(s => !s.isEmpty)) {
			vscode.commands.executeCommand('default:type', { text: '{' });
			return;
		}

		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const inlineMode = config.get('inlineMode', false);
		const indentUnit = getIndentUnit(editor);

		const editInfos = selections.map(s => {
			const result = findUnclosedDeclaration(document, s.active);
			if (!result) return null;
			return { ...result, cursor: s.active, currentLineNum: s.active.line };
		}).filter(Boolean)
			// Deduplicate: keep only one edit per unique line to prevent multi-cursor collisions
			.filter((info, index, self) =>
				self.findIndex(t => t.currentLineNum === info.currentLineNum) === index
			);

		if (editInfos.length === 0) {
			vscode.commands.executeCommand('default:type', { text: '{' });
			return;
		}

		const sortedEditInfos = [...editInfos].sort((a, b) => b.currentLineNum - a.currentLineNum);

		editor.edit(editBuilder => {
			for (const info of sortedEditInfos) {
				const { declarationIndent, isOnDeclarationLine, currentLineIsEmpty, cursor, currentLineNum } = info;

				if (inlineMode) {
					editBuilder.insert(cursor, '{};');
				} else {
					if (isOnDeclarationLine) {
						editBuilder.insert(cursor, '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
					} else if (currentLineIsEmpty) {
						editBuilder.replace(
							document.lineAt(currentLineNum).range,
							declarationIndent + '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};'
						);
					} else {
						editBuilder.insert(cursor, ' {\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
					}
				}
			}
		}).then(() => {
			const topToBottom = [...editInfos].sort((a, b) => a.currentLineNum - b.currentLineNum);
			let lineOffset = 0;

			const newSelections = topToBottom.map(info => {
				const { declarationIndent, isOnDeclarationLine, currentLineIsEmpty, cursor, currentLineNum } = info;
				let newPosition;

				if (inlineMode) {
					newPosition = new vscode.Position(cursor.line + lineOffset, cursor.character + 1);
					const key = positionKey(document.uri.toString(), newPosition);
					inlineBracketPositions.set(key, '};');
				} else {
					if (isOnDeclarationLine) {
						newPosition = new vscode.Position(cursor.line + lineOffset + 1, declarationIndent.length + indentUnit.length);
					} else if (currentLineIsEmpty) {
						newPosition = new vscode.Position(currentLineNum + lineOffset + 1, declarationIndent.length + indentUnit.length);
					} else {
						newPosition = new vscode.Position(cursor.line + lineOffset + 1, declarationIndent.length + indentUnit.length);
					}
					lineOffset += 2;
				}

				return new vscode.Selection(newPosition, newPosition);
			});

			editor.selections = newSelections;
			if (newSelections.length > 0) {
				editor.revealRange(new vscode.Range(newSelections[0].active, newSelections[0].active));
			}
		});
	});

	// ── Smart backspace command ──────────────────────────────────────────────
	const backspaceCommand = vscode.commands.registerCommand('cpp-class-bracket.smartBackspace', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const document = editor.document;
		const selections = editor.selections;

		if (selections.some(s => !s.isEmpty)) {
			vscode.commands.executeCommand('deleteLeft');
			return;
		}

		const allEmptyBrackets = selections.every(s => {
			const cursor = s.active;
			if (cursor.character === 0) return false;
			const charBefore = document.getText(new vscode.Range(cursor.translate(0, -1), cursor));
			if (charBefore !== '{') return false;
			const afterSemicolon = document.getText(new vscode.Range(cursor, cursor.translate(0, 2)));
			const afterBrace = document.getText(new vscode.Range(cursor, cursor.translate(0, 1)));
			return afterSemicolon === '};' || afterBrace === '}';
		});

		if (allEmptyBrackets) {
			editor.edit(editBuilder => {
				for (const s of selections) {
					const cursor = s.active;
					const afterSemicolon = document.getText(new vscode.Range(cursor, cursor.translate(0, 2)));
					const deleteEnd = afterSemicolon === '};'
						? cursor.translate(0, 2)
						: cursor.translate(0, 1);
					editBuilder.delete(new vscode.Range(cursor.translate(0, -1), deleteEnd));
					const key = positionKey(document.uri.toString(), cursor);
					inlineBracketPositions.delete(key);
				}
			});
		} else {
			for (const s of selections) {
				const key = positionKey(document.uri.toString(), s.active);
				inlineBracketPositions.delete(key);
			}
			vscode.commands.executeCommand('deleteLeft');
		}
	});

	// Only wipe tracked positions if the user typed something themselves
	const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
		const uri = event.document.uri.toString();
		for (const key of inlineBracketPositions.keys()) {
			if (key.startsWith(uri)) {
				const isOwnChange = event.contentChanges.every(change =>
					change.text === '{};' ||
					change.text === '{}' ||
					change.text === ' {};' ||
					change.text === ' {}' ||
					change.text === ''
				);
				if (!isOwnChange) {
					inlineBracketPositions.delete(key);
				}
			}
		}
	});

	// ── Status bar toggle button ─────────────────────────────────────────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'cpp-class-bracket.toggleInlineMode';
	statusBar.tooltip = 'Toggle C++ bracket inline mode';

	function updateStatusBar() {
		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const inlineMode = config.get('inlineMode', false);
		statusBar.text = inlineMode ? '$(bracket-dot) C++ Inline' : '$(bracket-dot) C++ Expanded';
		const editor = vscode.window.activeTextEditor;
		if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) {
			statusBar.show();
		} else {
			statusBar.hide();
		}
	}

	updateStatusBar();

	context.subscriptions.push(
		bracketCommand,
		toggleCommand,
		backspaceCommand,
		statusBar,
		changeDisposable,
		vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
		vscode.workspace.onDidChangeConfiguration(updateStatusBar)
	);
}

function deactivate() { }

module.exports = { activate, deactivate };