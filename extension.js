const vscode = require('vscode');

const inlineBracketPositions = new Map();

function positionKey(uri, position) {
	return `${uri}:${position.line}:${position.character}`;
}

// FIX: Helper to strip comments to prevent false positives
function stripComments(line) {
	return line
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/, '');
}

function getIndentUnit(editor) {
	const insertSpaces = editor.options.insertSpaces;
	const tabSize = editor.options.tabSize;
	if (insertSpaces) {
		return ' '.repeat(typeof tabSize === 'number' ? tabSize : 4);
	}
	return '\t';
}

function findUnclosedDeclaration(document, cursor) {
	const currentLineNum = cursor.line;
	let currentLineText = document.lineAt(currentLineNum).text;

	// Boundary check
	const lastBraceRawIndex = currentLineText.lastIndexOf('}');
	if (lastBraceRawIndex !== -1 && cursor.character > lastBraceRawIndex) {
		return null;
	}

	let cleanCurrentLine = currentLineText;
	if (cleanCurrentLine.trim().endsWith('}')) {
		const lastBraceIndex = cleanCurrentLine.lastIndexOf('}');
		cleanCurrentLine = cleanCurrentLine.substring(0, lastBraceIndex);
	}

	const lines = [];
	const inheritanceRegex = /^\s*(:\s*)?(public|protected|private)\b/;
	let foundDeclaration = false;
	let crossedBlockBoundary = false;

	// Parser loop with comment stripping
	for (let i = currentLineNum; i >= 0; i--) {
		let line = (i === currentLineNum) ? cleanCurrentLine : document.lineAt(i).text;
		line = stripComments(line); // Cleaned before evaluation

		if (i < currentLineNum && line.includes('{') && !/(class|struct|enum)\b/.test(line) && !foundDeclaration) {
			crossedBlockBoundary = true;
			break;
		}

		lines.unshift(line);

		if (/(class|struct|enum)\b/.test(line)) {
			foundDeclaration = true;
			break;
		}

		if (i < currentLineNum && line.trim() !== '' &&
			!/(class|struct|enum)\b/.test(line) &&
			!/^\s*:/.test(line) &&
			!inheritanceRegex.test(line) &&
			!/,\s*$/.test(line)) {
			break;
		}
	}

	if (crossedBlockBoundary || !foundDeclaration) return null;

	const joined = lines.join(' ').replace(/\s+/g, ' ').trim();

	// Matcher for keywords: handles class, struct, enum, enum class, enum struct
	const baseKeywordRegex = /(class|struct|enum(\s+(class|struct))?)\b/;
	const keywordMatch = joined.search(baseKeywordRegex);
	if (keywordMatch === -1) return null;

	// VALIDATION RULES (FIXED STYLE FROM BOTTOM VERSION):
	const hasIdentifier = /(class|struct|enum(\s+(class|struct))?)\s+\w+/.test(joined);
	const isTypedef = /\btypedef\s+(struct|class)\b/.test(joined);
	const isModernEnumKeyword = /\benum\s+(class|struct)\s*$/.test(joined);

	if (!hasIdentifier && !isTypedef && !isModernEnumKeyword) return null;
	if (joined.endsWith(';')) return null;
	if (joined.indexOf('{', keywordMatch) !== -1) return null;
	if (joined.substring(keywordMatch).includes('}')) return null;

	// Check cursor position against cleaned line
	const isCurrentLineDeclaration = baseKeywordRegex.test(stripComments(cleanCurrentLine));
	if (isCurrentLineDeclaration) {
		const textAfterCursor = stripComments(cleanCurrentLine.substring(cursor.character)).trim();
		if (textAfterCursor.length > 0) return null;
	}

	const declarationLine = lines.find(l => baseKeywordRegex.test(l));
	const indentMatch = declarationLine ? declarationLine.match(/^(\s*)/) : null;
	const declarationIndent = indentMatch ? indentMatch[1] : '';

	return {
		declarationIndent,
		isOnDeclarationLine: isCurrentLineDeclaration,
		currentLineIsEmpty: stripComments(cleanCurrentLine).trim() === ''
	};
}

function activate(context) {
	const toggleCommand = vscode.commands.registerCommand('cpp-class-bracket.toggleInlineMode', () => {
		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const current = config.get('inlineMode', false);
		config.update('inlineMode', !current, vscode.ConfigurationTarget.Global).then(() => {
			vscode.window.showInformationMessage(`C++ Auto Bracket: Inline mode ${!current ? 'ON ✅' : 'OFF ❌'}`);
		});
	});

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

		const editInfos = selections.map((s, originalIndex) => {
			const result = findUnclosedDeclaration(document, s.active);
			if (!result) return null;
			return { ...result, cursor: s.active, currentLineNum: s.active.line, originalIndex };
		}).filter(Boolean);

		if (editInfos.length === 0) {
			vscode.commands.executeCommand('default:type', { text: '{' });
			return;
		}

		const sortedEditInfos = [...editInfos].sort((a, b) => b.currentLineNum - a.currentLineNum);
		const finalPositionsMap = new Map();

		editor.edit(editBuilder => {
			for (const info of sortedEditInfos) {
				const { declarationIndent, isOnDeclarationLine, currentLineIsEmpty, cursor, currentLineNum, originalIndex } = info;
				const currentLineText = document.lineAt(currentLineNum).text;
				let targetLineNumber = currentLineNum;
				let targetCharPosition = 0;

				if (inlineMode) {
					if (currentLineText.trim() === '') {
						editBuilder.replace(document.lineAt(currentLineNum).range, declarationIndent + '{};');
						targetCharPosition = declarationIndent.length + 1;
					} else {
						editBuilder.insert(cursor, '{};');
						targetCharPosition = cursor.character + 1;
					}
				} else {
					if (isOnDeclarationLine) {
						editBuilder.insert(cursor, '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
						targetLineNumber = cursor.line + 1;
						targetCharPosition = declarationIndent.length + indentUnit.length;
					} else if (currentLineIsEmpty) {
						editBuilder.replace(document.lineAt(currentLineNum).range, declarationIndent + '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
						targetLineNumber = currentLineNum + 1;
						targetCharPosition = declarationIndent.length + indentUnit.length;
					} else {
						editBuilder.insert(cursor, ' {\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
						targetLineNumber = cursor.line + 1;
						targetCharPosition = declarationIndent.length + indentUnit.length;
					}
				}
				finalPositionsMap.set(originalIndex, new vscode.Position(targetLineNumber, targetCharPosition));
			}
		}).then(() => {
			const topToBottomInfos = [...editInfos].sort((a, b) => a.currentLineNum - b.currentLineNum);
			let lineOffset = 0;
			const orderedSelections = [];

			for (const info of topToBottomInfos) {
				const computedPos = finalPositionsMap.get(info.originalIndex);
				const adjustedPosition = new vscode.Position(computedPos.line + lineOffset, computedPos.character);
				if (!inlineMode) lineOffset += 2;
				else {
					const key = positionKey(document.uri.toString(), adjustedPosition);
					inlineBracketPositions.set(key, '};');
				}
				orderedSelections.push({ index: info.originalIndex, selection: new vscode.Selection(adjustedPosition, adjustedPosition) });
			}
			orderedSelections.sort((a, b) => a.index - b.index);
			editor.selections = orderedSelections.map(item => item.selection);
			if (editor.selections.length > 0) editor.revealRange(new vscode.Range(editor.selections[0].active, editor.selections[0].active));
		});
	});

	const forceBracketCommand = vscode.commands.registerCommand('cpp-class-bracket.forceInsertClassBracket', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const document = editor.document;
		const selections = editor.selections;

		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const inlineMode = config.get('inlineMode', false);
		const indentUnit = getIndentUnit(editor);

		const sortedSelections = [...selections]
			.map((s, idx) => ({ selection: s, originalIndex: idx }))
			.sort((a, b) => b.selection.active.line - a.selection.active.line);

		const finalPositionsMap = new Map();

		editor.edit(editBuilder => {
			for (const item of sortedSelections) {
				const cursor = item.selection.active;
				const currentLineText = document.lineAt(cursor.line).text;
				const indentMatch = currentLineText.match(/^(\s*)/);
				const lineIndent = indentMatch ? indentMatch[1] : '';

				let targetLineNumber = cursor.line;
				let targetCharPosition = 0;

				if (inlineMode) {
					editBuilder.insert(cursor, '{};');
					targetCharPosition = cursor.character + 1;
				} else {
					editBuilder.insert(cursor, '{\n' + lineIndent + indentUnit + '\n' + lineIndent + '};');
					targetLineNumber = cursor.line + 1;
					targetCharPosition = lineIndent.length + indentUnit.length;
				}
				finalPositionsMap.set(item.originalIndex, new vscode.Position(targetLineNumber, targetCharPosition));
			}
		}).then(() => {
			const topToBottom = [...selections]
				.map((s, idx) => ({ selection: s, originalIndex: idx }))
				.sort((a, b) => a.selection.active.line - b.selection.active.line);

			let lineOffset = 0;
			const orderedSelections = [];

			for (const item of topToBottom) {
				const computedPos = finalPositionsMap.get(item.originalIndex);
				const adjustedPosition = new vscode.Position(computedPos.line + lineOffset, computedPos.character);

				if (!inlineMode) lineOffset += 2;
				else {
					const key = positionKey(document.uri.toString(), adjustedPosition);
					inlineBracketPositions.set(key, '};');
				}
				orderedSelections.push({ index: item.originalIndex, selection: new vscode.Selection(adjustedPosition, adjustedPosition) });
			}
			orderedSelections.sort((a, b) => a.index - b.index);
			editor.selections = orderedSelections.map(item => item.selection);
		});
	});

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
					const deleteEnd = afterSemicolon === '};' ? cursor.translate(0, 2) : cursor.translate(0, 1);
					editBuilder.delete(new vscode.Range(cursor.translate(0, -1), deleteEnd));
					inlineBracketPositions.delete(positionKey(document.uri.toString(), cursor));
				}
			});
		} else {
			for (const s of selections) inlineBracketPositions.delete(positionKey(document.uri.toString(), s.active));
			vscode.commands.executeCommand('deleteLeft');
		}
	});

	const changeDisposable = vscode.workspace.onDidChangeTextDocument(event => {
		const uri = event.document.uri.toString();
		for (const key of inlineBracketPositions.keys()) {
			if (key.startsWith(uri)) {
				const isOwnChange = event.contentChanges.every(change => ['{};', '{}', ' {};', ' {}', ''].includes(change.text));
				if (!isOwnChange) inlineBracketPositions.delete(key);
			}
		}
	});

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'cpp-class-bracket.toggleInlineMode';
	statusBar.tooltip = 'Toggle C++ bracket inline mode';

	function updateStatusBar() {
		const config = vscode.workspace.getConfiguration('cppClassBracket');
		const inlineMode = config.get('inlineMode', false);
		statusBar.text = inlineMode ? '$(bracket-dot) C++ Inline' : '$(bracket-dot) C++ Expanded';
		const editor = vscode.window.activeTextEditor;
		if (editor && (editor.document.languageId === 'cpp' || editor.document.languageId === 'c')) statusBar.show();
		else statusBar.hide();
	}

	updateStatusBar();
	context.subscriptions.push(bracketCommand, forceBracketCommand, toggleCommand, backspaceCommand, statusBar, changeDisposable,
		vscode.window.onDidChangeActiveTextEditor(updateStatusBar), vscode.workspace.onDidChangeConfiguration(updateStatusBar));
}

function deactivate() { }
module.exports = { activate, deactivate };