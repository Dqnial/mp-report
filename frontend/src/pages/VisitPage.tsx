import {
  ActionIcon,
  Alert,
  Autocomplete,
  Box,
  Button,
  Center,
  Chip,
  Group,
  Loader,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBuildingStore,
  IconStethoscope,
  IconLock,
  IconTrash,
} from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  useContacts,
  useDayVisits,
  useDeleteVisit,
  usePlaces,
  useSaveVisit,
  useUserId,
  useVisit,
} from '../api/queries';
import type { VisitKind, VisitProduct } from '../api/types';
import { newClientId } from '../clientId';
import type { LocalVisit } from '../offline/db';
import { findPlace } from '../offline/local';
import { formatDay, todayIso } from '../dates';
import {
  COMMENT_PHRASES,
  DEVIATION_PHRASES,
  FACT_PHRASES,
  PRODUCTS,
  productText,
  SPECIALTIES,
} from '../products';
import classes from './VisitPage.module.css';

const dayPath = (date: string) => (date === todayIso() ? '/' : `/day/${date}`);

/** '2026-10-05' или ISO-время → «05.10» */
const shortDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export function VisitPage() {
  const { clientId } = useParams();
  const [params] = useSearchParams();
  const existing = useVisit(clientId);
  const date = existing.data?.date ?? params.get('date') ?? todayIso();
  const day = useDayVisits(date);

  if (day.isPending || (clientId && existing.isPending)) {
    return (
      <Center h="100dvh">
        <Loader />
      </Center>
    );
  }
  if (clientId && !existing.data) {
    return (
      <Center h="100dvh" p="md">
        <Text>Визит не найден</Text>
      </Center>
    );
  }
  if (existing.data?.fromFile) return <FileVisitView visit={existing.data} />;

  const kind = (existing.data?.kind ??
    (params.get('kind') === 'PHARMACY' ? 'PHARMACY' : 'DOCTOR')) as VisitKind;

  return (
    <VisitForm
      key={clientId ?? 'new'}
      date={date}
      initialKind={kind}
      visit={existing.data ?? undefined}
      dayVisits={day.data ?? []}
      fromPlan={
        params.get('place')
          ? {
              place: params.get('place')!,
              address: params.get('address') ?? '',
            }
          : undefined
      }
    />
  );
}

interface FormValues {
  kind: VisitKind;
  fullName: string;
  placeName: string;
  address: string;
  specialty: string;
  phone: string;
  products: VisitProduct[];
  comment: string;
  agreement: string;
  fact: string;
  deviation: string;
}

function initialValues(
  kind: VisitKind,
  visit: LocalVisit | undefined,
  dayVisits: LocalVisit[],
  fromPlan: { place: string; address: string } | undefined,
): FormValues {
  if (visit) {
    return {
      kind: visit.kind,
      fullName: visit.fullName ?? '',
      placeName: visit.placeName ?? '',
      address: visit.address ?? '',
      specialty: visit.specialty ?? '',
      phone: visit.phone ?? '',
      products: visit.products,
      comment: visit.comment ?? '',
      agreement: visit.agreement ?? '',
      fact: visit.fact ?? '',
      deviation: visit.deviation ?? '',
    };
  }
  // ЛПУ «залипает»: врачей обходят по несколько в одной поликлинике подряд.
  // Открыли из плана — ЛПУ из плана, буква в букву (чтобы лечь в его строки).
  const last = dayVisits.filter((v) => v.kind === kind && v.placeName).at(-1);
  const sticky = kind === 'DOCTOR' ? last : undefined;
  return {
    kind,
    fullName: '',
    placeName: fromPlan?.place ?? sticky?.placeName ?? '',
    address: fromPlan ? fromPlan.address : (sticky?.address ?? ''),
    specialty: '',
    phone: '',
    products: [],
    comment: '',
    agreement: '',
    fact: '',
    deviation: '',
  };
}

function VisitForm({
  date,
  initialKind,
  visit,
  dayVisits,
  fromPlan,
}: {
  date: string;
  initialKind: VisitKind;
  visit?: LocalVisit;
  dayVisits: LocalVisit[];
  fromPlan?: { place: string; address: string };
}) {
  const navigate = useNavigate();
  const save = useSaveVisit();
  const remove = useDeleteVisit();
  const clientId = useMemo(() => visit?.clientId ?? newClientId(), [visit]);
  const userId = useUserId();
  /** договорённость подставлена с прошлого визита — дата, чтобы показать */
  const [agreementFrom, setAgreementFrom] = useState<string | null>(null);
  /** что подставили сами и откуда — чтобы заменить при смене врача/аптеки,
   *  но не трогать то, что написано руками */
  const carried = useRef<{ text: string; source: 'contact' | 'place' } | null>(
    null,
  );

  const form = useForm<FormValues>({
    initialValues: initialValues(initialKind, visit, dayVisits, fromPlan),
    validate: {
      fullName: (v, all) =>
        v.trim() || all.placeName.trim() ? null : 'Укажите ФИО или ЛПУ',
    },
  });
  const { values } = form;
  const isPharmacy = values.kind === 'PHARMACY';

  // ─── автоподстановка ──────────────────────────────────────────────────────
  const [nameQuery] = useDebouncedValue(values.fullName.trim(), 250);
  const contacts = useContacts(nameQuery);
  const contactOptions = useMemo(() => {
    const seen = new Set<string>();
    return (contacts.data ?? []).filter((c) => {
      const key = c.fullName.toLowerCase();
      if (seen.has(key) || key === values.fullName.trim().toLowerCase()) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [contacts.data, values.fullName]);

  /**
   * Договорённость с прошлого визита — чтобы сейчас отметить её выполнение.
   * У врача — от врача, у аптеки — от аптеки (провизоры меняются).
   */
  const carryAgreement = (
    text: string | null | undefined,
    from: string | null | undefined,
    source: 'contact' | 'place',
  ) => {
    if (visit) return; // открыли сохранённый визит — там уже всё своё
    const current = form.getValues().agreement.trim();
    if (current && current !== carried.current?.text) return; // написал сам
    form.setFieldValue('agreement', text ?? '');
    carried.current = text ? { text, source } : null;
    setAgreementFrom(text ? (from ?? '') : null);
  };

  const pickContact = (fullName: string) => {
    const c = contactOptions.find((x) => x.fullName === fullName);
    if (!c) return;
    form.setValues({
      fullName: c.fullName,
      specialty: c.specialty ?? values.specialty,
      phone: c.phone ?? values.phone,
      ...(c.place && {
        placeName: c.place.name,
        address: c.place.address ?? '',
      }),
    });
    if (values.kind === 'DOCTOR') {
      carryAgreement(c.lastAgreement, c.lastAgreementDate, 'contact');
    }
  };

  /** быстрый ответ: в пустое поле — как есть, в заполненное — через запятую */
  const addTo = (field: 'fact' | 'deviation', phrase: string) => {
    const cur = values[field].trim();
    form.setFieldValue(field, cur ? `${cur}, ${phrase}` : phrase);
  };

  const [placeQuery] = useDebouncedValue(values.placeName.trim(), 250);
  const [addressQuery] = useDebouncedValue(values.address.trim(), 250);
  const places = usePlaces(values.kind, placeQuery);

  // аптека: договорённость — по названию и адресу аптеки (у сети одно
  // название на много адресов); сменили на «Врач» — подставленное от аптеки
  // убираем
  useEffect(() => {
    if (visit) return;
    if (values.kind !== 'PHARMACY') {
      if (carried.current?.source === 'place')
        carryAgreement(null, null, 'place');
      return;
    }
    let cancelled = false;
    void findPlace(userId, 'PHARMACY', placeQuery, addressQuery).then((p) => {
      if (!cancelled)
        carryAgreement(p?.lastAgreement, p?.lastAgreementDate, 'place');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.kind, placeQuery, addressQuery, userId]);
  // подсказки ЛПУ/аптек: филиалы с одним названием — отдельными вариантами
  // с адресом («Фармленд · Садовая 46»), иначе не выбрать нужный
  const placeChoices = useMemo(() => {
    const list = places.data ?? [];
    const count = new Map<string, number>();
    for (const p of list) count.set(p.name, (count.get(p.name) ?? 0) + 1);
    const seen = new Set<string>();
    return list.flatMap((p) => {
      const value =
        (count.get(p.name) ?? 0) > 1
          ? `${p.name} · ${p.address || 'без адреса'}`
          : p.name;
      if (seen.has(value)) return [];
      seen.add(value);
      return [{ value, place: p }];
    });
  }, [places.data]);
  const pickPlace = (value: string) => {
    const p = placeChoices.find((c) => c.value === value)?.place;
    if (!p) return;
    // Autocomplete после выбора сам впишет текст варианта — ставим своё следом
    setTimeout(() =>
      form.setValues({
        placeName: p.name,
        address: p.address ?? values.address,
      }),
    );
  };

  // ─── препараты ────────────────────────────────────────────────────────────
  const selected = values.products.map((p) => p.code);
  const toggleProducts = (codes: string[]) =>
    form.setFieldValue(
      'products',
      codes.map(
        (code) => values.products.find((p) => p.code === code) ?? { code },
      ),
    );
  const setPharmacyField = (
    code: string,
    field: PharmacyField,
    value: number | undefined,
  ) =>
    form.setFieldValue(
      'products',
      values.products.map((p) => {
        if (p.code !== code) return p;
        const next = { ...p, [field]: value };
        if (value == null) delete next[field];
        return next;
      }),
    );

  const addPhrase = (phrase: string) => {
    const c = values.comment.trim();
    form.setFieldValue('comment', c ? `${c}, ${phrase}` : phrase);
  };

  // Сохранение мгновенное — в память телефона; на сервер уйдёт в фоне,
  // в том числе когда появится сеть. Ждать ответа сервера не нужно.
  const submit = form.onSubmit((v) => {
    const clean = (s: string) => s.replace(/\s+/g, ' ').trim() || null;
    save.mutate(
      {
        clientId,
        existing: visit,
        payload: {
          date,
          kind: v.kind,
          fullName: clean(v.fullName),
          placeName: clean(v.placeName),
          address: clean(v.address),
          specialty: clean(v.specialty),
          phone: clean(v.phone),
          products: v.products,
          comment: clean(v.comment),
          agreement: clean(v.agreement),
          fact: clean(v.fact),
          deviation: clean(v.deviation),
        },
      },
      {
        onSuccess: () => {
          notifications.show({
            color: 'teal',
            message: navigator.onLine
              ? 'Визит сохранён'
              : 'Сохранён на телефоне — отправится, когда появится сеть',
          });
          navigate(dayPath(date), { replace: true });
        },
      },
    );
  });

  // Сразу уходим к списку, удаление дописывается следом (оно локальное и
  // мгновенное). Если ждать его окончания, форма успевала перечитать уже
  // удалённый визит и на миг показывала «Визит не найден».
  const onDelete = () => {
    if (!visit || !window.confirm('Удалить визит?')) return;
    remove.mutate(visit);
    navigate(dayPath(date), { replace: true });
  };

  return (
    <form onSubmit={submit} className={classes.page}>
      <Stack gap="md" p="md" className={classes.content}>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              variant="subtle"
              size="xl"
              aria-label="Назад"
              onClick={() => navigate(-1)}
            >
              <IconArrowLeft />
            </ActionIcon>
            <Stack gap={0}>
              <Title order={3}>{visit ? 'Визит' : 'Новый визит'}</Title>
              <Text size="sm" c="dimmed">
                {formatDay(date)}
              </Text>
            </Stack>
          </Group>
          {visit && (
            <ActionIcon
              variant="subtle"
              color="red"
              size="xl"
              aria-label="Удалить"
              loading={remove.isPending}
              onClick={onDelete}
            >
              <IconTrash />
            </ActionIcon>
          )}
        </Group>

        {visit?.syncState === 'error' && (
          <Alert
            color="red"
            icon={<IconAlertTriangle />}
            title="Сервер не принял визит"
          >
            {visit.syncError} Исправьте и сохраните ещё раз — визит отправится
            заново.
          </Alert>
        )}

        {/* тип визита — крупно и в цвет больших кнопок «Врач»/«Аптека» на главном */}
        <SegmentedControl
          fullWidth
          size="lg"
          radius="md"
          color={isPharmacy ? 'teal' : 'cyan'}
          className={classes.kind}
          data={[
            {
              value: 'DOCTOR',
              label: (
                <Group gap={8} justify="center" wrap="nowrap">
                  <IconStethoscope size={22} />
                  Врач
                </Group>
              ),
            },
            {
              value: 'PHARMACY',
              label: (
                <Group gap={8} justify="center" wrap="nowrap">
                  <IconBuildingStore size={22} />
                  Аптека
                </Group>
              ),
            },
          ]}
          {...form.getInputProps('kind')}
        />

        <Autocomplete
          label={isPharmacy ? 'ФИО провизора / зав. аптекой' : 'ФИО врача'}
          placeholder={isPharmacy ? 'Фамилия Имя' : 'Фамилия Имя Отчество'}
          data={contactOptions.map((c) => c.fullName)}
          filter={({ options }) => options}
          onOptionSubmit={pickContact}
          renderOption={({ option }) => {
            const c = contactOptions.find((x) => x.fullName === option.value);
            return (
              <Stack gap={0}>
                <Text>{option.value}</Text>
                <Text size="xs" c="dimmed">
                  {[c?.specialty, c?.place?.name].filter(Boolean).join(' · ')}
                </Text>
              </Stack>
            );
          }}
          autoCapitalize="words"
          maxLength={200}
          {...form.getInputProps('fullName')}
        />

        <Autocomplete
          label={isPharmacy ? 'Аптека' : 'ЛПУ'}
          placeholder={
            isPharmacy ? 'Например: Аптека Фармленд' : 'Например: ГП 17'
          }
          data={placeChoices.map((c) => c.value)}
          filter={({ options }) => options}
          onOptionSubmit={pickPlace}
          renderOption={({ option }) => {
            const p = placeChoices.find((c) => c.value === option.value)?.place;
            return (
              <Stack gap={0}>
                <Text>{p?.name ?? option.value}</Text>
                {p?.address && (
                  <Text size="xs" c="dimmed">
                    {p.address}
                  </Text>
                )}
              </Stack>
            );
          }}
          maxLength={200}
          {...form.getInputProps('placeName')}
        />

        <TextInput
          label="Адрес"
          placeholder="Например: Лесная 10"
          maxLength={300}
          {...form.getInputProps('address')}
        />

        <SimpleGrid cols={2}>
          <Autocomplete
            label="Специальность"
            placeholder={isPharmacy ? 'провизор' : 'ВОП, педиатр'}
            data={[...SPECIALTIES[values.kind]]}
            maxLength={100}
            {...form.getInputProps('specialty')}
          />
          <TextInput
            label="Телефон"
            placeholder="8 701 123 45 67"
            type="tel"
            inputMode="tel"
            maxLength={50}
            {...form.getInputProps('phone')}
          />
        </SimpleGrid>

        <Stack gap={6}>
          <Text fw={500}>Препараты</Text>
          <Chip.Group multiple value={selected} onChange={toggleProducts}>
            <SimpleGrid cols={2} spacing="xs">
              {PRODUCTS.map((p) => (
                <Chip
                  key={p.code}
                  value={p.code}
                  size="md"
                  radius="md"
                  className={classes.chip}
                >
                  {p.label}
                </Chip>
              ))}
            </SimpleGrid>
          </Chip.Group>
        </Stack>

        {isPharmacy && values.products.length > 0 && (
          <Paper withBorder p="sm">
            <Text fw={500} mb="xs">
              По аптеке, уп.
            </Text>
            <Stack gap="md">
              {values.products.map((p) => (
                <PharmacyRow
                  key={p.code}
                  product={p}
                  onChange={(field, v) => setPharmacyField(p.code, field, v)}
                />
              ))}
            </Stack>
          </Paper>
        )}

        <Paper withBorder p="sm">
          <Stack gap="sm">
            <Text fw={600}>
              {isPharmacy
                ? 'Договорённость с аптекой'
                : 'Договорённость с врачом'}
            </Text>
            <Textarea
              label="Договорённость"
              description={
                agreementFrom !== null
                  ? `С прошлого визита${agreementFrom ? ` (${shortDate(agreementFrom)})` : ''} — если договорились о новом, исправьте`
                  : isPharmacy
                    ? 'Перейдёт в следующий визит в эту аптеку'
                    : 'Перейдёт в следующий визит к этому врачу'
              }
              placeholder={
                isPharmacy
                  ? 'например: дозакажут Коф Йог 10 уп.'
                  : 'например: будет выписывать Коф Йог'
              }
              autosize
              minRows={1}
              maxLength={300}
              {...form.getInputProps('agreement')}
            />
            <Stack gap={6}>
              <TextInput
                label="Факт выполнения"
                placeholder={'Выполнили ли договорённость'}
                maxLength={300}
                {...form.getInputProps('fact')}
              />
              <Group gap={6}>
                {FACT_PHRASES[values.kind].map((p) => (
                  <UnstyledButton
                    key={p}
                    className={classes.phrase}
                    onClick={() => addTo('fact', p)}
                  >
                    + {p}
                  </UnstyledButton>
                ))}
              </Group>
            </Stack>
            <Stack gap={6}>
              <TextInput
                label="Отклонение от договорённости"
                placeholder="Что не так и почему"
                maxLength={300}
                {...form.getInputProps('deviation')}
              />
              <Group gap={6}>
                {DEVIATION_PHRASES[values.kind].map((p) => (
                  <UnstyledButton
                    key={p}
                    className={classes.phrase}
                    onClick={() => addTo('deviation', p)}
                  >
                    + {p}
                  </UnstyledButton>
                ))}
              </Group>
            </Stack>
          </Stack>
        </Paper>

        <Stack gap={6}>
          <Textarea
            label="Комментарий"
            placeholder={
              isPharmacy
                ? 'Например: обещала дозаказать, по спросу'
                : 'Например: посмотрит, попробует назначить'
            }
            autosize
            minRows={2}
            maxLength={500}
            {...form.getInputProps('comment')}
          />
          <Group gap={6}>
            {COMMENT_PHRASES[values.kind].map((phrase) => (
              <UnstyledButton
                key={phrase}
                className={classes.phrase}
                onClick={() => addPhrase(phrase)}
              >
                + {phrase}
              </UnstyledButton>
            ))}
          </Group>
        </Stack>

        {save.error && <Alert color="red">{save.error.message}</Alert>}
      </Stack>

      <Box className={classes.saveBar}>
        <Button type="submit" size="xl" fullWidth loading={save.isPending}>
          Сохранить
        </Button>
      </Box>
    </form>
  );
}

type PharmacyField = 'stock' | 'sold' | 'order';

const PHARMACY_FIELDS: { key: PharmacyField; label: string }[] = [
  { key: 'stock', label: 'Остаток' },
  { key: 'sold', label: 'Продали' },
  { key: 'order', label: 'Дозаказ' },
];

/** Аптека: по препарату остаток, продажи и дозаказ (уп.). Пустое — не пишем. */
function PharmacyRow({
  product,
  onChange,
}: {
  product: VisitProduct;
  onChange: (field: PharmacyField, value: number | undefined) => void;
}) {
  return (
    <Stack gap={4}>
      <Text fw={500}>{productText({ code: product.code })}</Text>
      <SimpleGrid cols={3} spacing="xs">
        {PHARMACY_FIELDS.map(({ key, label }) => (
          <NumberInput
            key={key}
            label={label}
            size="md"
            hideControls
            min={0}
            max={99999}
            allowNegative={false}
            allowDecimal={false}
            placeholder="—"
            inputMode="numeric"
            styles={{
              input: { textAlign: 'center' },
              label: { fontSize: 'var(--mantine-font-size-xs)' },
            }}
            value={product[key] ?? ''}
            onChange={(v) => onChange(key, v === '' ? undefined : Number(v))}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

/** Визит, импортированный из файла: только просмотр. */
function FileVisitView({ visit: v }: { visit: LocalVisit }) {
  const navigate = useNavigate();
  const rows: [string, string | null][] = [
    [v.kind === 'PHARMACY' ? 'Аптека' : 'ЛПУ', v.placeName],
    ['Адрес', v.address],
    ['ФИО', v.fullName],
    ['Специальность', v.specialty],
    ['Телефон', v.phone],
    ['Препараты', v.productsRaw ?? v.products.map(productText).join(', ')],
    ['Комментарий', v.comment],
    ['Договорённость', v.agreement],
    ['Факт выполнения', v.fact],
    ['Отклонение', v.deviation],
  ];
  return (
    <Stack gap="md" p="md">
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xl"
          aria-label="Назад"
          onClick={() => navigate(-1)}
        >
          <IconArrowLeft />
        </ActionIcon>
        <Stack gap={0}>
          <Title order={3}>Визит</Title>
          <Text size="sm" c="dimmed">
            {formatDay(v.date)}
          </Text>
        </Stack>
      </Group>
      <Alert icon={<IconLock />} color="gray">
        Этот визит уже записан в файле отчёта (строка {v.templateRow}). Чтобы
        исправить — поправьте файл в Excel и загрузите его заново.
      </Alert>
      <Paper withBorder p="md">
        <Stack gap="sm">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label}>
                <Text size="sm" c="dimmed">
                  {label}
                </Text>
                <Text>{value}</Text>
              </div>
            ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
