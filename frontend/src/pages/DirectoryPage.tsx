import {
  ActionIcon,
  Alert,
  Autocomplete,
  Badge,
  Button,
  Center,
  Checkbox,
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
  IconSearch,
} from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDirectoryEntries, useEditDirectoryEntry } from '../api/queries';
import type { DirectoryEdit, DirectoryEntry, Potential } from '../api/types';
import { PotentialPicker } from '../components/PotentialPicker';
import { monthOf, todayIso } from '../dates';
import { POTENTIALS, SPECIALTIES } from '../products';

type Tab = 'doctors' | 'pharmacies';
type Filter = 'all' | 'noPotential' | 'hidden';

const collator = new Intl.Collator('ru', {
  sensitivity: 'base',
  numeric: true,
});
const title = (e: DirectoryEntry) =>
  e.fullName || e.placeName || 'Без названия';
const norm = (s: string | null) => (s ?? '').toLowerCase().replace(/ё/g, 'е');
const potentialLabel = (p: Potential) =>
  POTENTIALS.find((x) => x.value === p)!.label;

/** '2026-10-05' → «05.10» */
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/**
 * Справочник врачей и аптек — то, из чего собирается «База врачей и аптек»:
 * поиск, правка карточки (заодно — тех же опечаток в визитах месяца),
 * потенциал, «не включать в базу».
 */
export function DirectoryPage() {
  const navigate = useNavigate();
  const entries = useDirectoryEntries();
  const [tab, setTab] = useState<Tab>('doctors');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<DirectoryEntry | null>(null);

  const list = useMemo(() => {
    const q = norm(query.trim());
    const digits = query.replace(/\D/g, '');
    return (entries.data?.[tab] ?? [])
      .filter((e) =>
        filter === 'hidden'
          ? e.hiddenFromBase
          : filter === 'noPotential'
            ? !e.potential && !e.hiddenFromBase
            : true,
      )
      .filter(
        (e) =>
          !q ||
          [e.fullName, e.placeName, e.address, e.specialty].some((v) =>
            norm(v).includes(q),
          ) ||
          (digits.length >= 3 &&
            (e.phone ?? '').replace(/\D/g, '').includes(digits)),
      )
      .sort((a, b) => collator.compare(title(a), title(b)));
  }, [entries.data, tab, filter, query]);

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

  return (
    <Stack gap="sm">
      {header}
      <SegmentedControl
        fullWidth
        size="md"
        value={tab}
        onChange={(v) => {
          setTab(v as Tab);
          if (v === 'pharmacies' && filter === 'noPotential') setFilter('all');
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
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <SegmentedControl
        size="xs"
        value={filter}
        onChange={(v) => setFilter(v as Filter)}
        data={[
          { value: 'all', label: 'Все' },
          ...(tab === 'doctors'
            ? [{ value: 'noPotential', label: 'Без потенциала' }]
            : []),
          { value: 'hidden', label: 'Не в базе' },
        ]}
      />
      <Text size="xs" c="dimmed">
        Нажмите на строку, чтобы исправить. Найдено: {list.length}
      </Text>

      <Stack gap={6}>
        {list.map((e) => (
          <UnstyledButton
            key={`${e.type}:${e.id}`}
            onClick={() => setEditing(e)}
          >
            <Paper
              withBorder
              p="sm"
              style={{ opacity: e.hiddenFromBase ? 0.6 : 1 }}
            >
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Text fw={600} style={{ minWidth: 0 }} truncate>
                  {title(e)}
                </Text>
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {e.potential && (
                    <Badge variant="light" color="cyan">
                      {potentialLabel(e.potential)}
                    </Badge>
                  )}
                  {e.hiddenFromBase && (
                    <Badge variant="light" color="gray">
                      не в базе
                    </Badge>
                  )}
                </Group>
              </Group>
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
            </Paper>
          </UnstyledButton>
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

  const submit = form.onSubmit((v) => {
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
    const changes: DirectoryEdit = {};
    // шлём только изменённое — чтобы не задеть то, что не трогали
    const text = (
      key: 'fullName' | 'specialty' | 'phone' | 'placeName' | 'address',
    ) => {
      if (clean(v[key]) !== (entry[key] ?? '')) changes[key] = clean(v[key]);
    };
    if (!isPlace) {
      text('fullName');
      text('specialty');
      text('phone');
    }
    text('placeName');
    text('address');
    if (!isPlace && isDoctor && v.potential !== entry.potential) {
      changes.potential = v.potential;
    }
    if (v.inBase === entry.hiddenFromBase) changes.hiddenFromBase = !v.inBase;
    if (!Object.keys(changes).length) return onClose();
    if (v.fixVisits) changes.fixVisitsFrom = `${monthOf(todayIso())}-01`;

    edit.mutate(
      { entry, changes },
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

  const textChanged = (
    ['fullName', 'specialty', 'phone', 'placeName', 'address'] as const
  ).some((k) => values[k].replace(/\s+/g, ' ').trim() !== (entry[k] ?? ''));

  return (
    <Modal
      opened
      onClose={onClose}
      fullScreen={mobile}
      title={isPlace ? 'Аптека' : isDoctor ? 'Врач' : 'Провизор'}
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
          {!isPlace && isDoctor && (
            <PotentialPicker
              value={values.potential}
              onChange={(p) => form.setFieldValue('potential', p)}
            />
          )}
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
              description="Там, где было старое значение — в отчёт уйдёт исправленное"
              {...form.getInputProps('fixVisits', { type: 'checkbox' })}
            />
          )}
          {edit.error && <Alert color="red">{edit.error.message}</Alert>}
          <Button type="submit" size="lg" loading={edit.isPending}>
            Сохранить
          </Button>
        </Stack>
      </form>
    </Modal>
  );
}
