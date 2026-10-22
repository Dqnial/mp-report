/**
 * Ячейка N «Комментарий». У врача после комментария — договорённость, факт
 * выполнения и отклонение (отдельных колонок под них в шаблоне нет):
 * «посмотрит. Договорённость: выписывать Коф Йог; факт: выписала 2 уп.; отклонение: нет»
 */
export function commentCellText(v: {
  comment?: string | null;
  agreement?: string | null;
  fact?: string | null;
  deviation?: string | null;
}) {
  const parts = [
    v.agreement && `Договорённость: ${v.agreement}`,
    v.fact && `факт: ${v.fact}`,
    v.deviation && `отклонение: ${v.deviation}`,
  ].filter(Boolean);
  const comment = v.comment?.trim().replace(/[.;,]$/, '');
  if (!parts.length) return comment || null;
  // если договорённости нет, «факт» открывает фразу — с заглавной
  const tail = parts.join('; ').replace(/^./, (c) => c.toUpperCase());
  return comment ? `${comment}. ${tail}` : tail;
}
