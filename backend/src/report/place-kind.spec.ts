import {
  chainToken,
  makePlaceKindGuesser,
  type KnownPlace,
} from './place-kind';

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min));
const place = (
  name: string,
  kind: KnownPlace['kind'],
  min = 0,
): KnownPlace => ({
  name,
  kind,
  updatedAt: at(min),
});

// справочник, как после импорта месяца
const KNOWN = [
  place('Фармленд Лесная 19', 'PHARMACY'),
  place('Фармленд Садовая', 'PHARMACY'),
  place('Фармленд Речная', 'PHARMACY'),
  place('ТОО Vita pharm', 'PHARMACY'),
  place('Городская поликлиника 29', 'CLINIC'),
  place('Альфа Мед', 'CLINIC'),
  place('Бета Клиник', 'CLINIC'),
];

describe('chainToken', () => {
  it('первое значимое слово', () => {
    expect(chainToken('Фармленд на Озёрной')).toBe('фармленд');
    expect(chainToken('ТОО Vita pharm')).toBe('vita');
    expect(chainToken('ГП 17')).toBe(null);
    expect(chainToken('Городская клиническая больница 12')).toBe('клиническая');
  });
});

describe('makePlaceKindGuesser', () => {
  const guess = makePlaceKindGuesser(KNOWN);

  it('новая точка известной сети — аптека, даже с меткой «Врач»', () => {
    // так бывает в реальных шаблонах
    expect(guess('Фармленд Полевая', 'Врач')).toBe('PHARMACY');
    // опечатка без пробела в шаблоне
    expect(guess('Фармлендполевая садовая', 'Аптека')).toBe('PHARMACY');
  });

  it('известное место — по справочнику, метка C не важна', () => {
    expect(guess('Бета Клиник', 'Аптека')).toBe('DOCTOR');
    expect(guess('альфа мед', 'Аптека')).toBe('DOCTOR');
  });

  it('место записано и врачом, и аптекой — побеждает последнее исправление', () => {
    const g = makePlaceKindGuesser([
      place('Фармленд Полевая', 'CLINIC', 1),
      place('Фармленд Полевая', 'PHARMACY', 5),
    ]);
    expect(g('Фармленд Полевая', 'Врач')).toBe('PHARMACY');
    const g2 = makePlaceKindGuesser([
      place('Фармленд Полевая', 'PHARMACY', 1),
      place('Фармленд Полевая', 'CLINIC', 5),
    ]);
    expect(g2('Фармленд Полевая', 'Аптека')).toBe('DOCTOR');
  });

  it('незнакомое место — по словам в названии, потом по метке C', () => {
    expect(guess('Аптека плюс Лесная', 'Врач')).toBe('PHARMACY');
    expect(guess('Евро Фарм', 'Врач')).toBe('PHARMACY');
    expect(guess('Детская поликлиника', 'Врач')).toBe('DOCTOR');
    expect(guess('Новый центр', 'Аптека')).toBe('PHARMACY');
    expect(guess('Новый центр', 'Врач')).toBe('DOCTOR');
  });
});
