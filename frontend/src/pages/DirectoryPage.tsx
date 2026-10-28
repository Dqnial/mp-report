import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Center,
  Checkbox,
  Chip,
  CloseButton,
  Group,
  Loader,
  Modal,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconPencil,
  IconSearch,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  keys,
  useDirectoryEntries,
  useEditDirectoryEntry,
} from '../api/queries';
import type {
  DirectoryEdit,
  DirectoryEntries,
  DirectoryEntry,
  Potential,
} from '../api/types';
import { PotentialPicker } from '../components/PotentialPicker';
import { monthOf, todayIso } from '../dates';
import { POTENTIALS, potentialInfo, SPECIALTIES } from '../products';

type Tab = 'doctors' | 'pharmacies';
type Filter = 'all' | Potential | 'none' | 'hidden';
type Sort = 'name' | 'place';

const collator = new Intl.Collator('ru', {
  sensitivity: 'base',
  numeric: true,
});
const title = (e: DirectoryEntry) =>
  e.fullName || e.placeName || 'Без названия';
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/ё/g, 'е');

/** '2026-10-05' → «05.10» */
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

const matches = (e: DirectoryEntry, filter: Filter) =>
  filter === 'all'
    ? true
    : filter === 'hidden'
      ? e.hiddenFromBase
      : filter === 'none'
        ? !e.potential && !e.hiddenFromBase
        : e.potential === filter;

/**
 * Справочник врачей и аптек — то, из чего собирается «База врачей и аптек»:
 * поиск, фильтр по потенциалу, потенциал одним нажатием прямо в списке,
 * правка карточки (заодно — тех же опечаток в визитах месяца), «не включать
 * в базу».
 */
export function DirectoryPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const entries = useDirectoryEntries();
  const edit = useEditDirectoryEntry();
  const [tab, setTab] = useState<Tab>('doctors');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DirectoryEntry | null>(null);

  const all = useMemo(() => entries.data?.[tab] ?? [], [entries.data, tab]);
  const count = (f: Filter) => all.filter((e) => matches(e, f)).length;

  const list = useMemo(() => {
    const q = norm(query.trim());
    const digits = query.replace(/\D/g, '');
    return all
      .filter((e) => matches(e, filter))
      .filter(
        (e) =>
          !q ||
          [e.fullName, e.placeName, e.address, e.specialty].some((v) =>
            norm(v).includes(q),
          ) ||
          (digits.length >= 3 &&
            (e.phone ?? '').replace(/\D/g, '').includes(digits)),
      )
      .sort((a, b) =>
        sort === 'place'
          ? collator.compare(a.placeName ?? '', b.placeName ?? '') ||
            collator.compare(title(a), title(b))
          : collator.compare(title(a), title(b)),
      );
  }, [all, filter, sort, query]);

  /** Потенциал одним нажатием: в списке сразу, на сервер — следом. */
  const setPotential = (entry: DirectoryEntry, potential: Potential | null) => {
    qc.setQueryData<DirectoryEntries>(
      keys.directoryEntries,
      (data) =>
        data && {
          ...data,
          doctors: data.doctors.map((e) =>
            e.id === entry.id ? { ...e, potential } : e,
          ),
        },
    );
    edit.mutate(
      { entry, changes: { potential } },
      {
        onError: (err) => {
          void qc.invalidateQueries({ queryKey: keys.directoryEntries });
          notifications.show({
            color: 'red',
            message: `Потенциал не сохранился: ${err.message}`,
          });
        },
      },
    );
  };

  const header = (
    <Group gap="xs" wrap="nowrap">
      <ActionIcon
        variant="subtle"
        size="xl"
        aria-label="Назад"
        onClick={() => navigate('/more')}
      >
        <IconArrowLeft size={26} />
      </ActionIcon>
      <Title order={3}>Справочник</Title>
    </Group>
  );

  if (entries.isError) {
    return (
      <Stack gap="md">
        {header}
        <Alert color="gray" icon={<IconAlertTriangle />}>
          Нет связи с сервером. Справочник правится на сервере — откройте, когда
          появится интернет.
        </Alert>
      </Stack>
    );
  }
  if (entries.isPending) {
    return (
      <Stack gap="md">
        {header}
        <Center py="xl">
          <Loader />
        </Center>
      </Stack>
    );
  }

  const chips: { value: Filter; label: string; color?: string }[] = [
    { value: 'all', label: 'Все' },
    ...(tab === 'doctors'
      ? [
          ...POTENTIALS.map((p) => ({
            value: p.value as Filter,
            label: p.label,
            color: p.color,
          })),
          { value: 'none' as Filter, label: 'Без потенциала' },
        ]
      : []),
    { value: 'hidden', label: 'Не в базе', color: 'gray' },
  ];

  return (
    <Stack gap="sm">
      {header}
      <SegmentedControl
        fullWidth
        size="md"
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          setFilter('all');
        }}
        data={[
          { value: 'doctors', label: `Врачи · ${entries.data.doctors.length}` },
          {
            value: 'pharmacies',
            label: `Аптеки · ${entries.data.pharmacies.length}`,
          },
        ]}
      />
      <TextInput
        size="md"
        placeholder="ФИО, ЛПУ, адрес или телефон"
        leftSection={<IconSearch size={18} />}
        rightSection={
          query && (
            <CloseButton aria-label="Очистить" onClick={() => setQuery('')} />
          )
        }
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />

      {/* фильтры видны все сразу (переносятся), у каждого — сколько записей */}
      <Chip.Group
        multiple={false}
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
      >
        <Group gap={6}>
          {chips.map((c) => (
            <Chip
              key={c.value}
              value={c.value}
              color={c.color}
              variant="light"
              size="sm"
            >
              {c.label} · {count(c.value)}
            </Chip>
          ))}
        </Group>
      </Chip.Group>

      <Group justify="space-between" wrap="nowrap">
        <Text size="xs" c="dimmed">
          Найдено: {list.length}
        </Text>
        <SegmentedControl
          size="xs"
          value={sort}
          onChange={(v) => setSort(v as Sort)}
          data={[
            { value: 'name', label: 'По ФИО' },
            {
              value: 'place',
              label: tab === 'doctors' ? 'По ЛПУ' : 'По аптеке',
            },
          ]}
        />
      </Group>

      <Stack gap={6}>
        {list.map((e) => (
          <EntryCard
            key={`${e.type}:${e.id}`}
            entry={e}
            isDoctor={tab === 'doctors'}
            onOpen={() => setEditing(e)}
            onPotential={(p) => setPotential(e, p)}
          />
        ))}
      </Stack>

      {editing && (
        <EditEntry
          key={`${editing.type}:${editing.id}`}
          entry={editing}
          isDoctor={tab === 'doctors'}
          onClose={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}

/**
 * Карточка: нажатие на текст — правка; у врача под ним — потенциал
 * одним нажатием. Слева полоса цвета потенциала.
 */
function EntryCard({
  entry: e,
  isDoctor,
  onOpen,
  onPotential,
}: {
  entry: DirectoryEntry;
  isDoctor: boolean;
  onOpen: () => void;
  onPotential: (p: Potential | null) => void;
}) {
  const potential = potentialInfo(e.potential);
  return (
    <Paper
      withBorder
      p="sm"
      style={{
        opacity: e.hiddenFromBase ? 0.6 : 1,
        borderLeft: `6px solid ${
          potential
            ? `var(--mantine-color-${potential.color}-6)`
            : 'var(--mantine-color-gray-3)'
        }`,
      }}
    >
      <Stack gap={6}>
        <Group
          justify="space-between"
          wrap="nowrap"
          align="flex-start"
          gap="xs"
        >
          <UnstyledButton onClick={onOpen} style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} truncate>
              {title(e)}
            </Text>
            <Text size="sm" c="dimmed" lineClamp={2}>
              {[
                e.specialty,
                e.fullName ? e.placeName : null,
                e.address,
                e.phone,
              ]
                .filter(Boolean)
                .join(' · ') || '—'}
            </Text>
            <Text size="xs" c="dimmed">
              {e.visits
                ? `Визитов: ${e.visits}, последний ${shortDate(e.lastVisit!)}`
                : 'Визитов нет — в базу не попадёт'}
            </Text>
          </UnstyledButton>
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            {e.hiddenFromBase && (
              <Badge variant="light" color="gray">
                не в базе
              </Badge>
            )}
            <ActionIcon variant="subtle" aria-label="Изменить" onClick={onOpen}>
              <IconPencil size={18} />
            </ActionIcon>
          </Group>
        </Group>
        {isDoctor && e.type === 'contact' && (
          <PotentialPicker compact value={e.potential} onChange={onPotential} />
        )}
      </Stack>
    </Paper>
  );
}

interface EditValues {
  fullName: string;
  specialty: string;
  phone: string;
  placeName: string;
  address: string;
  potential: Potential | null;
  inBase: boolean;
  fixVisits: boolean;
}

const TEXT_FIELDS = [
  'fullName',
  'specialty',
  'phone',
  'placeName',
  'address',
] as const;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function EditEntry({
  entry,
  isDoctor,
  onClose,
}: {
  entry: DirectoryEntry;
  isDoctor: boolean;
  onClose: () => void;
}) {
  const edit = useEditDirectoryEntry();
  const mobile = useMediaQuery('(max-width: 36em)');
  const isPlace = entry.type === 'place';
  const form = useForm<EditValues>({
    initialValues: {
      fullName: entry.fullName ?? '',
      specialty: entry.specialty ?? '',
      phone: entry.phone ?? '',
      placeName: entry.placeName ?? '',
      address: entry.address ?? '',
      potential: entry.potential,
      inBase: !entry.hiddenFromBase,
      fixVisits: true,
    },
    validate: {
      fullName: (v) => (!isPlace && !v.trim() ? 'Укажите ФИО' : null),
      placeName: (v) => (isPlace && !v.trim() ? 'Укажите название' : null),
    },
  });
  const { values } = form;

  // что изменили — шлём только это, чтобы не задеть то, что не трогали
  const changes = useMemo(() => {
    const c: DirectoryEdit = {};
    for (const key of TEXT_FIELDS) {
      if (isPlace && key !== 'placeName' && key !== 'address') continue;
      if (clean(values[key]) !== (entry[key] ?? ''))
        c[key] = clean(values[key]);
    }
    if (!isPlace && isDoctor && values.potential !== entry.potential) {
      c.potential = values.potential;
    }
    if (values.inBase === entry.hiddenFromBase)
      c.hiddenFromBase = !values.inBase;
    return c;
  }, [values, entry, isPlace, isDoctor]);
  const textChanged = TEXT_FIELDS.some((k) => k in changes);
  const changed = Object.keys(changes).length > 0;

  const submit = form.onSubmit((v) => {
    if (!changed) return onClose();
    const send = { ...changes };
    if (textChanged && v.fixVisits) {
      send.fixVisitsFrom = `${monthOf(todayIso())}-01`;
    }
    edit.mutate(
      { entry, changes: send },
      {
        onSuccess: (res) => {
          notifications.show({
            color: 'teal',
            message: res.fixedVisits
              ? `Сохранено. Исправлено визитов в этом месяце: ${res.fixedVisits}`
              : 'Сохранено',
          });
          onClose();
        },
      },
    );
  });

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen={mobile}
      title={
        <Stack gap={0}>
          <Text fw={700}>{title(entry)}</Text>
          <Text size="xs" c="dimmed">
            {isPlace ? 'Аптека' : isDoctor ? 'Врач' : 'Провизор'}
            {entry.visits
              ? ` · визитов: ${entry.visits}, последний ${shortDate(entry.lastVisit!)}`
              : ' · визитов нет'}
          </Text>
        </Stack>
      }
    >
      <form onSubmit={submit}>
        <Stack gap="sm">
          {!isPlace && (
            <TextInput
              label="ФИО"
              size="md"
              maxLength={200}
              {...form.getInputProps('fullName')}
            />
          )}
          {!isPlace && isDoctor && (
            <PotentialPicker
              value={values.potential}
              onChange={(p) => form.setFieldValue('potential', p)}
              description="Попадёт в базу врачей"
            />
          )}
          {!isPlace && (
            <Group grow gap="xs" align="flex-start">
              <Autocomplete
                label="Специальность"
                size="md"
                data={[...SPECIALTIES[isDoctor ? 'DOCTOR' : 'PHARMACY']]}
                maxLength={100}
                {...form.getInputProps('specialty')}
              />
              <TextInput
                label="Телефон"
                size="md"
                type="tel"
                inputMode="tel"
                maxLength={50}
                {...form.getInputProps('phone')}
              />
            </Group>
          )}
          <TextInput
            label={isDoctor ? 'ЛПУ' : 'Аптека'}
            size="md"
            maxLength={200}
            {...form.getInputProps('placeName')}
          />
          <TextInput
            label="Адрес"
            size="md"
            maxLength={300}
            {...form.getInputProps('address')}
          />
          <Switch
            size="md"
            label="Включать в базу врачей и аптек"
            description={
              values.inBase
                ? undefined
                : 'Строки не будет в файле базы. В подсказках при вводе визита останется'
            }
            {...form.getInputProps('inBase', { type: 'checkbox' })}
          />
          {textChanged && (
            <Checkbox
              label="Исправить и в визитах этого месяца"
              description="Там, где было старое значение — в отчёт уйдёт исправленное. Если врач перешёл в другое ЛПУ — снимите"
              {...form.getInputProps('fixVisits', { type: 'checkbox' })}
            />
          )}
          {edit.error && <Alert color="red">{edit.error.message}</Alert>}
          <Group grow gap="xs">
            <Button variant="default" size="lg" onClick={onClose}>
              Отмена
            </Button>
            <Button
              type="submit"
              size="lg"
              loading={edit.isPending}
              disabled={!changed}
            >
              Сохранить
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
