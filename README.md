# C++ Class/Struct Auto Bracket

If you've ever used **Visual Studio Community** and switched to **VS Code**, you probably noticed that VS Code doesn't automatically add a semicolon after the closing `}` of a `class`, `struct`, or `enum`. This extension fixes exactly that — and handles every C++ coding style you can throw at it.

---

## What It Does

When you finish typing a `class`, `struct`, or `enum` declaration and press `Shift+[`, instead of a plain `{` you get a fully formatted block with the correct closing `};` automatically:

```cpp
class MyClass {
    // cursor lands here
};
```

---

## Supported Declarations

Works with all common C++ declaration patterns:

| Declaration | Closing |
|---|---|
| `class Foo` | `};` |
| `struct Foo` | `};` |
| `enum class Foo` | `};` |
| `enum struct Foo` | `};` |
| `enum Foo` | `};` |
| `class Foo final` | `};` |
| `class Foo : public Bar` | `};` |
| `template<typename T> class Foo` | `};` |
| `struct alignas(16) Foo` | `};` |

Namespaces are intentionally left to VS Code's native behavior since they don't need a semicolon.

---

## Both Coding Styles Supported

### K&R Style
```cpp
class MyClass     ← press Shift+[ here
// becomes:
class MyClass {
    
};
```

### Allman Style
```cpp
class MyClass
              ← press Shift+[ here
// becomes:
class MyClass
{
    
};
```

### Multi-line Inheritance
```cpp
class MyClass
    : public Base,
      public IListener  ← press Shift+[ here
// becomes:
class MyClass
    : public Base,
      public IListener {
    
};
```

### Local Classes (inside functions)
```cpp
void init() { struct Config  ← press Shift+[ here
// becomes:
void init() { struct Config {
    
};
```

---

## Inline Mode

Prefer compact style? Enable **Inline Mode** to get `{};` with the cursor placed between `{` and `}`:

```cpp
class MyClass {};
```

Pressing backspace immediately after (before typing anything inside) deletes the entire `{};` in one keystroke.

### Toggle Inline Mode Three Ways
- Click **`⟨⟩ C++ Expanded`** in the status bar (bottom right)
- Press `Ctrl+Shift+;`
- Go to `Ctrl+,` → search **"C++ Class Bracket"** → check **Inline Mode**

---

## Smart Backspace

Whenever you have an empty `{};` or `{}` with your cursor between them and nothing typed inside, pressing `Backspace` deletes all of it at once — regardless of how it was inserted.

```cpp
class MyClass {};   ← cursor between { and } → Backspace → deletes all three ✅
class MyClass {x};  ← typed something inside → Backspace → normal backspace ✅
```

---

## Smart Behavior

- **Forward declarations ignored:** `class Foo;` → native `{` ✅
- **Already opened blocks ignored:** `class Foo {` → native `{` ✅
- **Cursor in middle of word:** `cl|ass Foo` → native `{` ✅
- **Cursor right after keyword:** `class| Foo` → native `{` ✅
- **Function signatures ignored:** `int main()` below a class → native `{` ✅
- **Comments ignored:** cursor inside `//` or `/* */` → native `{` ✅
- **Cursor inside string literal:** `string s = "cl|ass Foo"` → native `{` ✅
- **No declaration anywhere:** if no cursor matches a declaration, falls through entirely to VS Code's native `{` with auto-pairing ✅
- **Text selected:** falls through to VS Code native behavior ✅
- **Multiple cursors on different lines:** all handled simultaneously ✅
- **Multiple cursors on the same empty line:** each gets its own `{};` inline ✅
- **Mixed cursors:** declaration cursors get `{};`, non-declaration cursors get `{}` ✅
- **Tab vs spaces:** respects your VS Code `editor.tabSize` and `editor.insertSpaces` settings ✅

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Shift+[` | Insert `{};` block or native `{` |
| `Shift+Alt+[` | Force insert a block regardless of declaration detection (respects Inline/Expanded mode) |
| `Backspace` | Smart delete empty `{};` or normal backspace |
| `Ctrl+Shift+;` | Toggle inline mode |

You can change any of these in `Ctrl+,` → search **"Keyboard Shortcuts"** → search the command name.

---

## Installation

### From the Marketplace
Search for **"C++ Class/Struct Auto Bracket"** in the Extensions panel (`Ctrl+Shift+X`).

### From a VSIX file
```
code --install-extension cpp-class-bracket-1.2.10.vsix
```
Or drag the `.vsix` file directly into the Extensions panel.

---

## Requirements

- VS Code `^1.75.0`
- A `.cpp`, `.c`, `.h`, or `.hpp` file

---

## Release Notes

### 1.2.9 — 1.2.10
- Documentation hotfix to sync README versioning

### 1.2.8
- Fixed multiple cursors on the same empty line below a declaration inserting `{};` inline instead of the correct expanded block in expanded mode

### 1.2.7
- Fixed freeze/no-op when multiple cursors are on the same empty line below a declaration — each cursor now correctly gets its own `{};` inserted at its position
- Fixed `int main()` and other function signatures below a class incorrectly triggering the extension
- Fixed cursor inside string literals (e.g. `string s = "cl|ass Foo"`) incorrectly triggering the extension
- Fixed cursor inside block comments `/* */` incorrectly triggering the extension
- Improved multi-cursor handling — non-declaration cursors correctly receive native `{}` in the same edit transaction
- Added memoization and full document line cache for faster detection with many cursors
- Added 30-line lookback hard limit to prevent unnecessary scanning in large files

### 1.2.6
- Fixed cursor right after keyword triggering the extension (e.g. `class| Foo`)
- Fixed cursor in middle of word triggering the extension (e.g. `cla|ss c`)
- Fixed non-declaration lines like `int main()` below a class triggering the extension
- Fixed trailing `}` on the current line causing incorrect detection
- Comments are now stripped before evaluation — declarations inside `//` no longer cause false positives
- Improved block boundary detection with cleaner internal logic
- Fixed multi-cursor position restoration when multiple cursors are active

### 1.2.4 — 1.2.5
- Icon updates

### 1.2.3
- Fixed template and macro declarations not triggering the extension
- Fixed multi-cursor collision when two cursors are near the same declaration

### 1.2.2
- Fixed inheritance lines being destroyed when cursor is on them
- Fixed `{class c}` with cursor on empty line below incorrectly triggering

### 1.2.1
- Rewrote core detection logic to a single clean "collect and join" approach
- Now handles all inheritance styles, `final` keyword, nested classes, and more

### 1.2.0
- Plain `enum` now correctly gets `};`
- Namespace removed from extension — handled natively by VS Code
- Smarter cursor position detection

### 1.1.5
- Fixed destructive bug where non-declaration lines like `int main()` could be replaced

### 1.1.0
- Fixed cursor in middle of line triggering the extension
- Fixed Allman style indentation
- Added publisher information

### 1.0.9
- Fixed multi-cursor positions in expanded mode

### 1.0.6
- Added `enum class`, `enum struct`, plain `enum` support
- Added inline mode with status bar toggle
- Added tab vs spaces support
- Added smart backspace

### 1.0.3
- Simplified to only intercept `class`/`struct` lines, everything else native

### 1.0.0
- Initial release

---

## Contributing

Found a bug or want to suggest something? Open an issue or pull request on GitHub!

---

## License

MIT