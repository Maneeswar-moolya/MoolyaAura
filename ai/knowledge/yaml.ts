/**
 * A YAML reader for exactly the subset this project's knowledge files use.
 *
 * Hand-rolled because `yaml` is not a dependency here and adding one to read four
 * small files is a poor trade. The subset is deliberately narrow and is what
 * `ai/knowledge/page/*.yaml` is written in:
 *
 *   nested maps by indentation      key:\n  child: value
 *   lists of scalars                - one
 *   lists of maps                   - name: x\n    detail: y
 *   inline lists                    [a, b, c]
 *   scalars                         plain, 'single', "double", true/false, numbers
 *   block scalars                   key: >\n  folded text     and  key: |
 *   comments                        # to end of line, when not inside quotes
 *
 * Anything outside that - anchors, nested flow mappings, multiple documents - is
 * NOT supported and will either throw or be read as a plain string. That is the
 * point: a knowledge file that needs those has stopped being compact and
 * human-reviewable, which is the property the whole phase depends on.
 *
 * Block scalars were originally excluded on the same reasoning, and that was wrong.
 * The first knowledge file a generator wrote used `>` for its longer descriptions -
 * which is the idiomatic, most readable way to write them - and the parser threw,
 * taking the whole knowledge directory down with it. A subset narrow enough to
 * reject what a careful author naturally writes is not a simplification, it is a
 * trap. They are folded during pre-processing rather than parsed, which keeps the
 * indentation logic below untouched.
 *
 * `parse` throws with a line number rather than returning something half-read. A
 * malformed knowledge file must be a loud failure, not silently missing knowledge
 * that makes the generator think it has to explore from scratch.
 *
 * Line endings are normalised once, at the entry to `parse`, before anything else
 * looks at the text. Every step below is line-oriented and splits on '\n', which
 * leaves a trailing '\r' on every line of a CRLF file - harmless in the places that
 * `trim()` anyway, fatal in the one place that anchors a pattern to end-of-line.
 * `key: >` arrives as `key: >\r`, the block-scalar opener does not match, the block
 * is never folded, and its first body line reaches the indentation parser as a
 * structural error: "Unexpected indentation on line 73". The YAML is valid; only
 * the checkout differed. That is not hypothetical - it is what a `git clone` of
 * this repository produces on Windows, where `core.autocrlf=true` is the installer
 * default, so a file committed as LF lands on disk as CRLF and the generator dies
 * on knowledge it wrote itself.
 *
 * Normalising here rather than widening that one regex is deliberate: it fixes the
 * whole class instead of the one instance, so a line-oriented rule added later
 * cannot reintroduce it. `\r\n` and a lone `\r` both become `\n` - YAML 1.2 counts
 * all three as line breaks - which keeps line NUMBERS honest too, since a
 * classic-Mac file would otherwise be read as one enormous line.
 *
 * This rewrites only the text the parser walks. `raw` is captured by the caller
 * from the file itself and is never touched, so what a person or an agent reads
 * back is still exactly what they wrote.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

interface Line {
  indent: number;
  text: string;
  number: number;
}

/** Strip a trailing comment that is not inside quotes. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (quote) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === quote)
        quote = null;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    // A '#' only starts a comment at the start or after whitespace.
    if (char === '#' && (index === 0 || /\s/.test(raw[index - 1])))
      return raw.slice(0, index);
  }
  return raw;
}

function scalar(raw: string, lineNumber: number): YamlValue {
  const text = raw.trim();
  if (!text)
    return '';
  if ((text.startsWith('"') && text.endsWith('"') && text.length > 1)
    || (text.startsWith('\'') && text.endsWith('\'') && text.length > 1)) {
    const inner = text.slice(1, -1);
    return text[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, '\'');
  }
  if (text.startsWith('[')) {
    if (!text.endsWith(']'))
      throw new Error(`Unclosed inline list on line ${lineNumber}`);
    const body = text.slice(1, -1).trim();
    if (!body)
      return [];
    return body.split(',').map(part => scalar(part, lineNumber));
  }
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?\d*\.\d+$/.test(text)) return Number.parseFloat(text);
  return text;
}

/** Split `key: value`, honouring quotes so a colon inside a string is safe. */
function splitKey(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === quote)
        quote = null;
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (char === ':' && (index + 1 === text.length || /\s/.test(text[index + 1]))) {
      return { key: text.slice(0, index).trim().replace(/^['"]|['"]$/g, ''), rest: text.slice(index + 1).trim() };
    }
  }
  return null;
}

/**
 * Rewrite `key: >` / `key: |` blocks into a single quoted scalar on one line.
 *
 * Done before anything else so the indentation parser never has to know that some
 * lines are text rather than structure - inside a block scalar, `#` is not a comment
 * and a blank line is content, both of which would otherwise need special cases
 * threaded through the lexer.
 *
 * Newlines are folded to spaces for both styles. These values are prose read by a
 * matcher and inlined into a prompt as the file's own raw text, so the distinction
 * between folded and literal carries no meaning here - and `raw` is never rewritten,
 * so what a person or an agent reads back is exactly what they wrote.
 */
function foldBlockScalars(source: string): string {
  const raw = source.split('\n');
  const out: string[] = [];

  for (let index = 0; index < raw.length; index++) {
    const opener = /^(\s*)([^:#]+):[ \t]*([|>])[-+]?\d*[ \t]*$/.exec(raw[index]);
    if (!opener) {
      out.push(raw[index]);
      continue;
    }

    const [, indent, key] = opener;
    const body: string[] = [];
    let scan = index + 1;
    for (; scan < raw.length; scan++) {
      if (!raw[scan].trim()) {
        body.push('');
        continue;
      }
      if (raw[scan].length - raw[scan].trimStart().length <= indent.length)
        break;
      body.push(raw[scan].trim());
    }
    while (body.length && !body[body.length - 1])
      body.pop();

    const text = body.join(' ').replace(/\s+/g, ' ').trim();
    out.push(`${indent}${key}: "${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
    index = scan - 1;
  }

  return out.join('\n');
}

/**
 * CRLF and lone CR both become LF, so every line-oriented step below sees the same
 * text whichever platform checked the file out. Nothing else about the document
 * changes: the line COUNT is identical for a CRLF file, so reported line numbers
 * still point at what an editor shows.
 */
function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n?/g, '\n');
}

export function parse(document: string): YamlValue {
  const source = foldBlockScalars(normalizeLineEndings(document));
  const lines: Line[] = [];
  source.split('\n').forEach((raw, index) => {
    const withoutComment = stripComment(raw);
    if (!withoutComment.trim())
      return;
    lines.push({
      indent: withoutComment.length - withoutComment.trimStart().length,
      text: withoutComment.trim(),
      number: index + 1,
    });
  });

  if (!lines.length)
    return {};

  let cursor = 0;

  /** Parse every line at `indent` or deeper, starting at the cursor. */
  function block(indent: number): YamlValue {
    if (cursor >= lines.length)
      return null;

    if (lines[cursor].text.startsWith('- '))
      return sequence(indent);
    return mapping(indent);
  }

  function sequence(indent: number): YamlValue[] {
    const items: YamlValue[] = [];
    while (cursor < lines.length && lines[cursor].indent === indent && lines[cursor].text.startsWith('- ')) {
      const line = lines[cursor];
      const inner = line.text.slice(2).trim();
      cursor++;

      const pair = splitKey(inner);
      if (pair) {
        // `- name: x` starts a map whose remaining keys are indented further.
        const item: { [key: string]: YamlValue } = {};
        item[pair.key] = pair.rest ? scalar(pair.rest, line.number) : nested(indent + 2, line.number);
        while (cursor < lines.length && lines[cursor].indent > indent && !lines[cursor].text.startsWith('- ')) {
          const child = lines[cursor];
          const childPair = splitKey(child.text);
          if (!childPair)
            throw new Error(`Expected "key: value" on line ${child.number}, got: ${child.text}`);
          cursor++;
          item[childPair.key] = childPair.rest ? scalar(childPair.rest, child.number) : nested(child.indent + 1, child.number);
        }
        items.push(item);
        continue;
      }
      items.push(scalar(inner, line.number));
    }
    return items;
  }

  function mapping(indent: number): { [key: string]: YamlValue } {
    const result: { [key: string]: YamlValue } = {};
    while (cursor < lines.length && lines[cursor].indent === indent) {
      const line = lines[cursor];
      if (line.text.startsWith('- '))
        break;
      const pair = splitKey(line.text);
      if (!pair)
        throw new Error(`Expected "key: value" on line ${line.number}, got: ${line.text}`);
      cursor++;
      result[pair.key] = pair.rest ? scalar(pair.rest, line.number) : nested(indent + 1, line.number);
    }
    return result;
  }

  /** The value of a key that had nothing after its colon. */
  function nested(minimumIndent: number, lineNumber: number): YamlValue {
    if (cursor >= lines.length || lines[cursor].indent < minimumIndent)
      return null;
    const childIndent = lines[cursor].indent;
    const value = block(childIndent);
    if (value === null)
      throw new Error(`Nothing followed the key on line ${lineNumber}`);
    return value;
  }

  const parsed = block(lines[0].indent);
  if (cursor < lines.length)
    throw new Error(`Unexpected indentation on line ${lines[cursor].number}: ${lines[cursor].text}`);
  return parsed;
}
