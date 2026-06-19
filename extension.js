const vscode = require('vscode');

const inlineBracketPositions = new Map();

function positionKey(uri, position) {
	return `${uri}:${position.line}:${position.character}`;
}

function stripComments(line) {
	return line
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/.*$/, '');
}

// Safely removes template arguments (including nested ones) to allow the regex to parse base classes easily
function stripTemplateArgs(text) {
	let result = '';
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '<') {
			depth++;
		} else if (text[i] === '>') {
			if (depth > 0) depth--;
		} else if (depth === 0) {
			result += text[i];
		}
	}
	return result;
}

// Precise scanner to check if the cursor character is inside a comment or string literal
function isCursorInCommentOrString(lineText, charIndex) {
	let inString = false;
	let stringQuote = '';
	let inBlockComment = false;

	for (let i = 0; i < charIndex; i++) {
		const char = lineText[i];
		const nextChar = lineText[i + 1];

		if (inBlockComment) {
			if (char === '*' && nextChar === '/') {
				inBlockComment = false;
				i++;
			}
			continue;
		}

		if (inString) {
			if (char === '\\') {
				i++;
			} else if (char === stringQuote) {
				inString = false;
			}
			continue;
		}

		if (char === '/' && nextChar === '/') return true;

		if (char === '/' && nextChar === '*') {
			inBlockComment = true;
			i++;
			continue;
		}

		if (char === '"' || char === "'") {
			inString = true;
			stringQuote = char;
			continue;
		}
	}
	return inBlockComment || inString;
}

function getIndentUnit(editor) {
	const insertSpaces = editor.options.insertSpaces;
	const tabSize = editor.options.tabSize;
	if (insertSpaces) {
		return ' '.repeat(typeof tabSize === 'number' ? tabSize : 4);
	}
	return '\t';
}

// OPTIMIZED: Uses allLines cache and memoization to prevent duplicate scanning per line.
// NOTE: memo caches DETECTION result only (does class exist above?), not cursor character.
// Multiple cursors on the same line correctly share the detection result but each get
// their own insertion at their individual character positions.
function findUnclosedDeclaration(cursor, allLines, memo) {
	const currentLineNum = cursor.line;

	// Check if we already scanned this line number — reuse detection result.
	// Safe because detection depends on line content and context, not cursor character.
	if (memo.has(currentLineNum)) return memo.get(currentLineNum);

	const currentLineText = allLines[currentLineNum];

	// 1. Abort if cursor is inside a comment or string literal
	if (isCursorInCommentOrString(currentLineText, cursor.character)) {
		memo.set(currentLineNum, null); return null;
	}

	// 2. GLOBAL GUARDRAIL: Prevent triggering mid-word or mid-line on ANY line.
	// Applied to all lines — fixes int m|ain() below a class triggering.
	const textAfterCursor = stripComments(currentLineText.substring(cursor.character)).trim();
	if (textAfterCursor.length > 0) {
		memo.set(currentLineNum, null); return null;
	}

	const textBeforeCursorClean = stripComments(currentLineText.substring(0, cursor.character));
	const isDeclarationOnCurrentLine = /(class|struct|enum)\b/.test(textBeforeCursorClean);

	if (!isDeclarationOnCurrentLine) {
		const textWithoutTemplates = stripTemplateArgs(textBeforeCursorClean);
		// Strict match: supports namespaces ([\w:]+) and stripped templates.
		// Parentheses excluded from [^;{()] — rejects int main(), void foo() etc.
		// since parentheses never appear in valid inheritance continuation lines.
		const validInheritanceLineRegex = /^\s*(:\s*)?((public|protected|private)\s+)?[\w:]+(\s*,\s*((public|protected|private)\s+)?[\w:]+)*\s*$/;
		if (textBeforeCursorClean.trim() !== '' && !validInheritanceLineRegex.test(textWithoutTemplates)) {
			memo.set(currentLineNum, null); return null;
		}
	}

	// Boundary check: cursor is past a closing brace on the same line
	const lastBraceRawIndex = currentLineText.lastIndexOf('}');
	if (lastBraceRawIndex !== -1 && cursor.character > lastBraceRawIndex) {
		memo.set(currentLineNum, null); return null;
	}

	let cleanCurrentLine = currentLineText;
	if (cleanCurrentLine.trim().endsWith('}')) {
		const lastBraceIndex = cleanCurrentLine.lastIndexOf('}');
		cleanCurrentLine = cleanCurrentLine.substring(0, lastBraceIndex);
	}

	const linesToEval = [];
	const inheritanceRegex = /^\s*(:\s*)?(public|protected|private)\b/;
	let foundDeclaration = false;
	let crossedBlockBoundary = false;

	// HARD GUARDRAIL: Only scan up to 30 lines back.
	const lookbackLimit = Math.max(0, currentLineNum - 30);

	for (let i = currentLineNum; i >= lookbackLimit; i--) {
		let line = (i === currentLineNum) ? cleanCurrentLine : allLines[i];
		line = stripComments(line);

		if (i < currentLineNum && line.includes('{') && !/(class|struct|enum)\b/.test(line) && !foundDeclaration) {
			crossedBlockBoundary = true;
			break;
		}

		linesToEval.push(line);

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

	if (crossedBlockBoundary || !foundDeclaration) {
		memo.set(currentLineNum, null); return null;
	}

	linesToEval.reverse();
	const joined = linesToEval.join(' ').replace(/\s+/g, ' ').trim();

	const baseKeywordRegex = /(class|struct|enum(\s+(class|struct))?)\b/;
	const keywordMatch = joined.search(baseKeywordRegex);
	if (keywordMatch === -1) {
		memo.set(currentLineNum, null); return null;
	}

	const hasIdentifier = /(class|struct|enum(\s+(class|struct))?)\s+\w+/.test(joined);
	const isTypedef = /\btypedef\s+(struct|class)\b/.test(joined);
	const isModernEnumKeyword = /\benum\s+(class|struct)\s*$/.test(joined);

	if (!hasIdentifier && !isTypedef && !isModernEnumKeyword) {
		memo.set(currentLineNum, null); return null;
	}
	if (joined.endsWith(';')) { memo.set(currentLineNum, null); return null; }
	if (joined.indexOf('{', keywordMatch) !== -1) { memo.set(currentLineNum, null); return null; }
	if (joined.substring(keywordMatch).includes('}')) { memo.set(currentLineNum, null); return null; }

	const isCurrentLineDeclaration = baseKeywordRegex.test(stripComments(cleanCurrentLine));
	const declarationLine = linesToEval.find(l => baseKeywordRegex.test(l));
	const indentMatch = declarationLine ? declarationLine.match(/^(\s*)/) : null;
	const declarationIndent = indentMatch ? indentMatch[1] : '';

	const result = {
		declarationIndent,
		isOnDeclarationLine: isCurrentLineDeclaration,
		currentLineIsEmpty: stripComments(cleanCurrentLine).trim() === ''
	};

	memo.set(currentLineNum, result);
	return result;
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

		// INSTANT CACHE: Get the whole document text at once — avoids per-line IPC calls.
		const allLines = document.getText().split(/\r?\n/);
		const processingMemo = new Map();

		const editInfos = selections.map((s, originalIndex) => {
			const result = findUnclosedDeclaration(s.active, allLines, processingMemo);
			if (!result) {
				return { isClass: false, cursor: s.active, currentLineNum: s.active.line, originalIndex };
			}
			return { isClass: true, ...result, cursor: s.active, currentLineNum: s.active.line, originalIndex };
		});

		// If zero cursors matched a declaration, fall through entirely to native VS Code behavior
		if (editInfos.every(info => !info.isClass)) {
			vscode.commands.executeCommand('default:type', { text: '{' });
			return;
		}

		// Count how many cursors share each line — needed to decide replace vs insert below
		const cursorsPerLine = new Map();
		for (const info of editInfos) {
			if (info.isClass) {
				cursorsPerLine.set(info.currentLineNum, (cursorsPerLine.get(info.currentLineNum) || 0) + 1);
			}
		}

		// Sort bottom-to-top for safe structural insertions (avoids line number shifting)
		const sortedEditInfos = [...editInfos].sort((a, b) => b.currentLineNum - a.currentLineNum);
		const finalPositionsMap = new Map();

		// Track which empty lines have already been replaced so we don't do it twice
		const linesReplaced = new Set();

		editor.edit(editBuilder => {
			for (const info of sortedEditInfos) {
				const { isClass, cursor, currentLineNum, originalIndex } = info;
				const currentLineText = allLines[currentLineNum];
				let targetLineNumber = currentLineNum;
				let targetCharPosition = 0;

				if (isClass) {
					const { declarationIndent, isOnDeclarationLine, currentLineIsEmpty } = info;

					// FIX: If multiple cursors share the same empty line below a declaration,
					// treat every cursor as an inline insert at their character position.
					// Replacing the line once and ignoring the rest caused a freeze/no-op.
					const multipleCursorsOnLine = (cursorsPerLine.get(currentLineNum) || 1) > 1;

					if (inlineMode) {
						if (currentLineText.trim() === '' && !multipleCursorsOnLine) {
							// Single cursor on empty line — replace whole line with indented {};
							if (!linesReplaced.has(currentLineNum)) {
								editBuilder.replace(document.lineAt(currentLineNum).range, declarationIndent + '{};');
								linesReplaced.add(currentLineNum);
							}
							targetCharPosition = declarationIndent.length + 1;
						} else {
							// Multiple cursors on empty line OR cursor on non-empty line — insert at cursor
							editBuilder.insert(cursor, '{};');
							targetCharPosition = cursor.character + 1;
						}
					} else {
						if (isOnDeclarationLine) {
							editBuilder.insert(cursor, '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
							targetLineNumber = cursor.line + 1;
							targetCharPosition = declarationIndent.length + indentUnit.length;
						} else if (currentLineIsEmpty && !multipleCursorsOnLine) {
							// Single cursor on empty line — replace whole line cleanly
							if (!linesReplaced.has(currentLineNum)) {
								editBuilder.replace(document.lineAt(currentLineNum).range, declarationIndent + '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
								linesReplaced.add(currentLineNum);
							}
							targetLineNumber = currentLineNum + 1;
							targetCharPosition = declarationIndent.length + indentUnit.length;
						} else {
							// Multiple cursors on empty line OR cursor on non-empty continuation line
							// Insert expanded brackets at cursor position
							editBuilder.insert(cursor, '{\n' + declarationIndent + indentUnit + '\n' + declarationIndent + '};');
							targetLineNumber = cursor.line + 1;
							targetCharPosition = declarationIndent.length + indentUnit.length;
						}
					}
				} else {
					// Non-declaration cursor: insert {} so the cursor isn't left abandoned.
					// editor.edit() bypasses VS Code's auto-pair pipeline, so we insert {} not {.
					editBuilder.insert(cursor, '{}');
					targetLineNumber = currentLineNum;
					targetCharPosition = cursor.character + 1;
				}

				finalPositionsMap.set(originalIndex, { targetLineNumber, targetCharPosition, isClass });
			}
		}).then((success) => {
			if (!success) return;

			// Re-sort top-to-bottom, left-to-right to apply line/char offsets correctly
			const topToBottomInfos = [...editInfos].sort((a, b) => {
				if (a.currentLineNum === b.currentLineNum) {
					return a.cursor.character - b.cursor.character;
				}
				return a.currentLineNum - b.currentLineNum;
			});

			let lineOffset = 0;
			let lastProcessedLineNum = -1;
			let charOffset = 0;
			const orderedSelections = [];

			for (const info of topToBottomInfos) {
				const computedPos = finalPositionsMap.get(info.originalIndex);

				// Reset char offset when moving to a new line
				if (info.currentLineNum !== lastProcessedLineNum) {
					charOffset = 0;
					lastProcessedLineNum = info.currentLineNum;
				}

				let targetLineNumber = computedPos.targetLineNumber + lineOffset;
				let targetCharPosition = computedPos.targetCharPosition;

				// Apply charOffset only if cursor stayed on its original line (inline insert)
				if (computedPos.targetLineNumber === info.currentLineNum) {
					targetCharPosition += charOffset;
				}

				const adjustedPosition = new vscode.Position(targetLineNumber, targetCharPosition);

				if (computedPos.isClass) {
					if (!inlineMode) {
						lineOffset += 2;
					} else {
						const key = positionKey(document.uri.toString(), adjustedPosition);
						inlineBracketPositions.set(key, '};');
						charOffset += 3;
					}
				} else {
					charOffset += 2;
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

		// --- NEW FEATURE: The Selection Wrapper ---
		if (selections.some(s => !s.isEmpty)) {
			// This single line handles the brackets, the semicolon, preserves the exact 
			// multi-cursor selections, and ensures Ctrl+Z works in one click!
			editor.insertSnippet(new vscode.SnippetString('{${1:$TM_SELECTED_TEXT}};'));
			return;
		}
		// ------------------------------------------

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
				.sort((a, b) => {
					if (a.selection.active.line === b.selection.active.line) {
						return a.selection.active.character - b.selection.active.character;
					}
					return a.selection.active.line - b.selection.active.line;
				});

			let lineOffset = 0;
			let lastProcessedLineNum = -1;
			let charOffset = 0;
			const orderedSelections = [];

			for (const item of topToBottom) {
				const computedPos = finalPositionsMap.get(item.originalIndex);

				if (item.selection.active.line !== lastProcessedLineNum) {
					charOffset = 0;
					lastProcessedLineNum = item.selection.active.line;
				}

				let targetLineNumber = computedPos.line + lineOffset;
				let targetCharPosition = computedPos.character;

				if (computedPos.line === item.selection.active.line) {
					targetCharPosition += charOffset;
				}

				const adjustedPosition = new vscode.Position(targetLineNumber, targetCharPosition);

				if (!inlineMode) {
					lineOffset += 2;
				} else {
					const key = positionKey(document.uri.toString(), adjustedPosition);
					inlineBracketPositions.set(key, '};');
					charOffset += 3;
				}

				orderedSelections.push({ index: item.originalIndex, selection: new vscode.Selection(adjustedPosition, adjustedPosition) });
			}
			orderedSelections.sort((a, b) => a.index - b.index);
			editor.selections = orderedSelections.map(item => item.selection);
		});
	});

	// Native brace escape hatch: bypass the extension entirely and let VS Code
	// handle { normally — auto-pairs to {}, positions cursor, no semicolon added.
	const nativeBraceCommand = vscode.commands.registerCommand('cpp-class-bracket.nativeBrace', () => {
		vscode.commands.executeCommand('default:type', { text: '{' });
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
	context.subscriptions.push(
		bracketCommand,
		forceBracketCommand,
		nativeBraceCommand,
		toggleCommand,
		backspaceCommand,
		statusBar,
		changeDisposable,
		vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
		vscode.workspace.onDidChangeConfiguration(updateStatusBar),
	);
}

function deactivate() { }
module.exports = { activate, deactivate };