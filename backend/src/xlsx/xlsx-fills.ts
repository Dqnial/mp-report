// Заливка ячеек без пересборки стилей книги: в styles.xml дописываются
// заливки и копии форматов ячеек с ними. Исходные форматы не меняются —
// ячейка получает номер копии своего же формата (шрифт, рамки, выравнивание
// те же), отличается только заливка.
import { attr } from './xlsx-xml';

const XF_RE = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;

/** Задать атрибут в открывающем теге (заменить или дописать). */
function setAttr(tag: string, name: string, value: string) {
  return new RegExp(`\\s${name}="`).test(tag)
    ? tag.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${name}="${value}"`)
    : `${tag} ${name}="${value}"`;
}

export class FillStyles {
  private readonly newFills: string[] = [];
  private readonly fillIds = new Map<string, number>();
  private readonly newXfs: string[] = [];
  private readonly xfIds = new Map<string, number>();

  private constructor(
    private readonly xml: string,
    private readonly fillCount: number,
    private readonly xfs: string[],
  ) {}

  /** null — стили устроены непривычно: тогда просто не заливаем. */
  static parse(xml: string | null) {
    if (!xml) return null;
    const fills = xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/);
    const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
    if (!fills || !cellXfs) return null;
    const fillCount = (fills[1].match(/<fill\b/g) ?? []).length;
    const xfs = cellXfs[1].match(XF_RE) ?? [];
    if (!fillCount || !xfs.length) return null;
    return new FillStyles(xml, fillCount, xfs);
  }

  /** Номер формата «как style, но со сплошной заливкой argb». */
  styleWith(style: number, argb: string) {
    const key = `${style}:${argb}`;
    const known = this.xfIds.get(key);
    if (known !== undefined) return known;

    let fillId = this.fillIds.get(argb);
    if (fillId === undefined) {
      fillId = this.fillCount + this.newFills.length;
      this.newFills.push(
        `<fill><patternFill patternType="solid"><fgColor rgb="${argb}"/><bgColor indexed="64"/></patternFill></fill>`,
      );
      this.fillIds.set(argb, fillId);
    }
    const base = this.xfs[style] ?? this.xfs[0];
    const open = base.match(/^<xf\b[^>]*?(?=\/?>)/)![0];
    const tag = setAttr(
      setAttr(open, 'fillId', String(fillId)),
      'applyFill',
      '1',
    );
    const id = this.xfs.length + this.newXfs.length;
    this.newXfs.push(tag + base.slice(open.length));
    this.xfIds.set(key, id);
    return id;
  }

  get changed() {
    return this.newXfs.length > 0;
  }

  toXml() {
    const append = (
      xml: string,
      section: 'fills' | 'cellXfs',
      items: string[],
      total: number,
    ) =>
      xml.replace(
        new RegExp(`(<${section}\\b[^>]*>)([\\s\\S]*?)(</${section}>)`),
        (_, open: string, body: string, close: string) =>
          setAttr(open.slice(0, -1), 'count', String(total)) +
          '>' +
          body +
          items.join('') +
          close,
      );
    const withFills = append(
      this.xml,
      'fills',
      this.newFills,
      this.fillCount + this.newFills.length,
    );
    return append(
      withFills,
      'cellXfs',
      this.newXfs,
      this.xfs.length + this.newXfs.length,
    );
  }
}

/** Перекрасить ячейки строки в колонках cols: style → styleFor(style). */
export function restyleCells(
  rowXml: string,
  cols: readonly string[],
  styleFor: (style: number) => number,
) {
  return rowXml.replace(/<c\b[^>]*?(?=\/?>)/g, (open) => {
    const col = attr(open, 'r')?.replace(/\d+/g, '');
    if (!col || !cols.includes(col)) return open;
    return setAttr(open, 's', String(styleFor(Number(attr(open, 's') ?? 0))));
  });
}
