import { commentCellText } from './comment-cell';

describe('commentCellText', () => {
  it('только комментарий — как был', () => {
    expect(commentCellText({ comment: 'посмотрит' })).toBe('посмотрит');
    expect(commentCellText({})).toBe(null);
  });

  it('врач: комментарий + договорённость, факт, отклонение', () => {
    expect(
      commentCellText({
        comment: 'посмотрит.',
        agreement: 'выписывать Коф Йог',
        fact: 'выписала 2 уп.',
        deviation: 'нет',
      }),
    ).toBe(
      'посмотрит. Договорённость: выписывать Коф Йог; факт: выписала 2 уп.; отклонение: нет',
    );
  });

  it('без комментария и без части полей', () => {
    expect(commentCellText({ agreement: 'попробует Куркуму' })).toBe(
      'Договорённость: попробует Куркуму',
    );
    expect(
      commentCellText({ fact: 'не выписывал', deviation: 'нет в аптеках' }),
    ).toBe('Факт: не выписывал; отклонение: нет в аптеках');
  });
});
