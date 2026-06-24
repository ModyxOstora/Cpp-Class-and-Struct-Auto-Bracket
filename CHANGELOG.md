# Change Log

All notable changes to the "C++ Class/Struct Auto Semicolon & Bracket" extension will be documented in this file.

## [1.2.12]
- Changing extension's name

## [1.2.11]
- Added `Ctrl+Shift+[` shortcut — inserts a plain native `{` bypassing the extension entirely, letting VS Code handle auto-pairing and cursor positioning as if the extension didn't exist
- Added selection wrap to `Shift+Alt+[` — select any text and press the shortcut to wrap it in `{};` with the cursor landing inside, selection preserved, and single `Ctrl+Z` to undo

## [1.2.9] — [1.2.10]
- Documentation hotfix to sync README versioning

## [1.2.8]
- Fixed multiple cursors on the same empty line below a declaration inserting `{};` inline instead of the correct expanded block in expanded mode

## [1.2.7]
- Fixed freeze/no-op when multiple cursors are on the same empty line below a declaration — each cursor now correctly gets its own `{};` inserted at its position
- Fixed `int main()` and other function signatures below a class incorrectly triggering the extension
- Fixed cursor inside string literals (e.g. `string s = "cl|ass Foo"`) incorrectly triggering the extension
- Fixed cursor inside block comments `/* */` incorrectly triggering the extension
- Improved multi-cursor handling — non-declaration cursors correctly receive native `{}` in the same edit transaction
- Added memoization and full document line cache for faster detection with many cursors
- Added 30-line lookback hard limit to prevent unnecessary scanning in large files

## [1.2.6]
- Fixed cursor right after keyword triggering the extension (e.g. `class| Foo`)
- Fixed cursor in middle of word triggering the extension (e.g. `cla|ss c`)
- Fixed non-declaration lines like `int main()` below a class triggering the extension
- Fixed trailing `}` on the current line causing incorrect detection
- Comments are now stripped before evaluation — declarations inside `//` no longer cause false positives
- Improved block boundary detection with cleaner internal logic
- Fixed multi-cursor position restoration when multiple cursors are active

## [1.2.4] — [1.2.5]
- Icon updates

## [1.2.3]
- Fixed template and macro declarations not triggering the extension
- Fixed multi-cursor collision when two cursors are near the same declaration

## [1.2.2]
- Fixed inheritance lines being destroyed when cursor is on them
- Fixed `{class c}` with cursor on empty line below incorrectly triggering

## [1.2.1]
- Rewrote core detection logic to a single clean "collect and join" approach
- Now handles all inheritance styles, `final` keyword, nested classes, and more

## [1.2.0]
- Plain `enum` now correctly gets `};`
- Namespace removed from extension — handled natively by VS Code
- Smarter cursor position detection

## [1.1.5]
- Fixed destructive bug where non-declaration lines like `int main()` could be replaced

## [1.1.0]
- Fixed cursor in middle of line triggering the extension
- Fixed Allman style indentation
- Added publisher information

## [1.0.9]
- Fixed multi-cursor positions in expanded mode

## [1.0.6]
- Added `enum class`, `enum struct`, plain `enum` support
- Added inline mode with status bar toggle
- Added tab vs spaces support
- Added smart backspace

## [1.0.3]
- Simplified to only intercept `class`/`struct` lines, everything else native

## [1.0.0]
- Initial release