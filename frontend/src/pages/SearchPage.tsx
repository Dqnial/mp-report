import {
  ActionIcon,
  Alert,
  Chip,
  CloseButton,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconArrowLeft,
  IconArrowsSort,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconWifiOff,
} from '@tabler/icons-react';
import { Fragment, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  useDayVisits,
  useMonthVisits,
  useServerSearch,
  useSyncStatus,
} from '../api/queries';
import { VisitCard } from '../components/VisitCard';
import {
  addDays,
  formatDay,
  formatMonth,
  monthOf,
  shiftWorkday,
  todayIso,
} from '../dates';
import type { LocalVisit } from '../offline/db';
import { ensureMonth } from '../offline/sync';
import { plural } from '../plural';
import {
  applyFilters,
  matchesQuery,
  SORT_LABELS,
  sortVisits,
  type KindFilter,
  type SortMode,
} from '../visitSearch';

type Scope = 'day' | 'month' | 'all';

/** Больше карточек сразу не рисуем — телефону тяжело, да и не нужно. */
const SHOW_LIMIT = 150;

/** «2026-10» ± n месяцев */
const shiftMonth = (month: string, n: number) =>
  monthOf(addDays(`${month}-15`, n * 30));

/**
 * Поиск по визитам: за день (по умолчанию — сегодня), за месяц или по всем
 * визитам. День и месяц ищутся в памяти телефона (работает без сети), «все» —
 * на сервере. Всё состояние — в адресе страницы: «Назад» из визита
 * возвращает к тем же результатам.
 */
export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const sync = useSyncStatus();

  const q = params.get('q') ?? '';
  const scope = (params.get('scope') as Scope | null) ?? 'day';
  const date = params.get('date') ?? todayIso();
  const month = params.get('month') ?? monthOf(date);
  const kind = (params.get('kind') as KindFilter | null) ?? 'all';
  const gaps = params.get('gaps') === '1';
  const unsent = params.get('unsent') === '1';
  const sort =
    (params.get('sort') as SortMode | null) ??
    (scope === 'day' ? 'order' : 'newest');

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const [debouncedQ] = useDebouncedValue(q.trim(), 350);
  const day = useDayVisits(date);
  const monthVisits = useMonthVisits(month, scope === 'month');
  const server = useServerSearch(
    debouncedQ,
    scope === 'all' && debouncedQ.length >= 2,
  );

  // месяц — из памяти телефона; если его там ещё нет, подтянуть с сервера
  useEffect(() => {
    if (scope === 'month') void ensureMonth(month);
    if (scope === 'day') void ensureMonth(monthOf(date));
  }, [scope, month, date]);
  // найденное в других месяцах — подтянуть эти месяцы на телефон, чтобы визит открывался
  const foundMonths = [
    ...new Set((server.data?.visits ?? []).map((v) => v.month)),
  ].join(',');
  useEffect(() => {
    for (const m of foundMonths.split(',').filter(Boolean)) void ensureMonth(m);
  }, [foundMonths]);

  const source: LocalVisit[] | undefined =
    scope === 'day'
      ? day.data
      : scope === 'month'
        ? monthVisits.data
        : server.data?.visits;
  const loading =
    scope === 'day'
      ? day.isPending
      : scope === 'month'
        ? monthVisits.isPending
        : debouncedQ.length >= 2 && server.isPending;

  const found = sortVisits(
    applyFilters(
      (source ?? []).filter((v) => matchesQuery(v, q)),
      { kind, gaps, unsent },
    ),
    sort,
  );
  const shown = found.slice(0, SHOW_LIMIT);
  const byDate = sort === 'order' || sort === 'newest';
  const needQuery = scope === 'all' && q.trim().length < 2;

  return (
    <Stack gap="sm">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xl"
          aria-label="Назад"
          // открыли поиск по ссылке (истории нет) — на экран визитов
          onClick={() =>
            (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')
          }
        >
          <IconArrowLeft size={26} />
        </ActionIcon>
        <Title order={3}>Поиск визитов</Title>
      </Group>

      <TextInput
        size="lg"
        radius="md"
        placeholder="ФИО, ЛПУ, аптека, телефон…"
        leftSection={<IconSearch size={20} />}
        rightSection={
          q && (
            <CloseButton
              size="lg"
              aria-label="Очистить"
              onClick={() => set({ q: null })}
            />
          )
        }
        value={q}
        onChange={(e) => set({ q: e.currentTarget.value })}
        // клавиатура сразу — только при первом входе, не при возврате из визита
        autoFocus={!q}
        enterKeyHint="search"
      />

      <SegmentedControl
        fullWidth
        size="md"
        radius="md"
        value={scope}
        onChange={(v) => set({ scope: v, sort: null })}
        data={[
          { value: 'day', label: 'День' },
          { value: 'month', label: 'Месяц' },
          { value: 'all', label: 'Все визиты' },
        ]}
      />

      {scope !== 'all' && (
        <Group justify="space-between" wrap="nowrap">
          <ActionIcon
            variant="subtle"
            size="xl"
            aria-label="Назад"
            onClick={() =>
              scope === 'day'
                ? set({ date: shiftWorkday(date, -1), month: null })
                : set({ month: shiftMonth(month, -1) })
            }
          >
            <IconChevronLeft size={26} />
          </ActionIcon>
          <Text fw={600} ta="center">
            {scope === 'day'
              ? date === todayIso()
                ? `Сегодня, ${formatDay(date)}`
                : capitalize(formatDay(date))
              : capitalize(formatMonth(month))}
          </Text>
          <ActionIcon
            variant="subtle"
            size="xl"
            aria-label="Вперёд"
            onClick={() =>
              scope === 'day'
                ? set({ date: shiftWorkday(date, 1), month: null })
                : set({ month: shiftMonth(month, 1) })
            }
          >
            <IconChevronRight size={26} />
          </ActionIcon>
        </Group>
      )}

      <Group gap={6}>
        <Chip.Group
          multiple={false}
          value={kind}
          onChange={(v) => set({ kind: v === 'all' ? null : v })}
        >
          <Chip value="all">Все</Chip>
          <Chip value="DOCTOR" color="cyan">
            Врачи
          </Chip>
          <Chip value="PHARMACY" color="teal">
            Аптеки
          </Chip>
        </Chip.Group>
        <Chip
          checked={gaps}
          color="gray"
          onChange={(c) => set({ gaps: c ? '1' : null })}
        >
          Чего-то не хватает
        </Chip>
        <Chip
          checked={unsent}
          color="orange"
          onChange={(c) => set({ unsent: c ? '1' : null })}
        >
          Не отправлены
        </Chip>
      </Group>

      <Select
        size="md"
        radius="md"
        leftSection={<IconArrowsSort size={18} />}
        value={sort}
        onChange={(v) => v && set({ sort: v })}
        allowDeselect={false}
        data={Object.entries(SORT_LABELS).map(([value, label]) => ({
          value,
          label,
        }))}
        aria-label="Сортировка"
      />

      {needQuery ? (
        <Text c="dimmed" ta="center" py="lg">
          Введите хотя бы 2 буквы или цифры — поиск по всем месяцам
        </Text>
      ) : scope === 'all' && server.isError ? (
        <Alert color="gray" icon={<IconWifiOff />}>
          {sync.offline
            ? 'Без интернета поиск по всем визитам не работает — выберите «День» или «Месяц»: они ищутся в памяти телефона.'
            : server.error.message}
        </Alert>
      ) : loading ? (
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      ) : (
        <>
          <Text size="sm" c="dimmed" ta="center">
            {found.length
              ? `Найдено: ${found.length} ${plural(found.length, ['визит', 'визита', 'визитов'])}`
              : 'Ничего не найдено'}
            {server.data?.truncated &&
              scope === 'all' &&
              ' — показаны последние, уточните запрос'}
          </Text>
          {shown.map((v, i) => {
            const newDay =
              byDate && scope !== 'day' && v.date !== shown[i - 1]?.date;
            return (
              <Fragment key={v.clientId}>
                {newDay && (
                  <Text fw={700} size="sm" c="dimmed" pt={i ? 'xs' : 0}>
                    {capitalize(formatDay(v.date))} ·{' '}
                    {shown.filter((x) => x.date === v.date).length}
                  </Text>
                )}
                {!byDate && scope !== 'day' && (
                  <Text size="xs" c="dimmed" mb={-4}>
                    {capitalize(formatDay(v.date))}
                  </Text>
                )}
                <VisitCard visit={v} />
              </Fragment>
            );
          })}
          {found.length > SHOW_LIMIT && (
            <Text size="sm" c="dimmed" ta="center">
              Показаны первые {SHOW_LIMIT} — уточните поиск или фильтры
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
