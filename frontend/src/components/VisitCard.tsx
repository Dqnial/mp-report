import { Badge, Group, Paper, Stack, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBuildingHospital,
  IconBuildingStore,
  IconClockHour4,
  IconFileSpreadsheet,
  IconMapPin,
  IconMessage,
  IconPhone,
  IconPill,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LocalVisit } from '../offline/db';
import { productText } from '../products';
import { missingFields, missingLabel, type MissingField } from '../visitFields';
import classes from './VisitCard.module.css';

/**
 * Карточка визита: у каждого поля своё место и значок — ФИО крупно, ЛПУ/аптека,
 * адрес, телефон, препараты. Пустое поле не подменяется другим (раньше без ФИО
 * на его месте стояло название аптеки), а пишется серым «нет …».
 * У визитов «из файла» пустые поля не показываем: их заполняли в Excel до
 * приложения, и пустое там — обычное дело.
 */
export function VisitCard({
  visit: v,
  n,
}: {
  visit: LocalVisit;
  /** номер в списке дня; без него — без номера (поиск) */
  n?: number;
}) {
  const products =
    v.fromFile && !v.products.length
      ? (v.productsRaw ?? '')
      : v.products.map(productText).join(', ');
  const missing = new Set(missingFields(v));
  const isPharmacy = v.kind === 'PHARMACY';

  /** значение поля или серое «нет …»; у визитов из файла пустое — не показываем */
  const field = (name: MissingField, value: ReactNode) =>
    missing.has(name) ? (
      v.fromFile ? null : (
        <Text span size="sm" className={classes.missing}>
          нет {missingLabel(name, v.kind)}
        </Text>
      )
    ) : (
      value
    );

  const line = (icon: ReactNode, content: ReactNode) =>
    content && (
      <Group gap={6} wrap="nowrap" align="flex-start">
        <span className={classes.icon}>{icon}</span>
        <div className={classes.value}>{content}</div>
      </Group>
    );

  return (
    <Paper
      component={Link}
      to={`/visit/${encodeURIComponent(v.clientId)}`}
      p="sm"
      radius="md"
      withBorder
      className={classes.card}
      data-from-file={v.fromFile || undefined}
    >
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {n != null && (
          <Text c="dimmed" fw={600} w={24}>
            {n}.
          </Text>
        )}
        <Stack gap={3} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6}>
            {missing.has('fullName') ? (
              <Text fw={600} className={classes.missing}>
                нет ФИО
              </Text>
            ) : (
              <Text fw={700} size="lg" lh={1.25} className={classes.value}>
                {v.fullName}
              </Text>
            )}
            {v.specialty && (
              <Badge
                variant="light"
                color={isPharmacy ? 'teal' : 'cyan'}
                style={{ flexShrink: 0 }}
              >
                {v.specialty}
              </Badge>
            )}
            {v.fromFile && (
              <IconFileSpreadsheet
                size={16}
                color="gray"
                aria-label="из файла"
                style={{ flexShrink: 0 }}
              />
            )}
            {v.syncState === 'pending' && (
              <IconClockHour4
                size={16}
                color="var(--mantine-color-orange-7)"
                aria-label="ждёт отправки"
              />
            )}
            {v.syncState === 'error' && (
              <IconAlertTriangle
                size={16}
                color="var(--mantine-color-red-7)"
                aria-label="сервер не принял"
              />
            )}
          </Group>

          {line(
            isPharmacy ? (
              <IconBuildingStore
                size={18}
                color="var(--mantine-color-teal-7)"
              />
            ) : (
              <IconBuildingHospital
                size={18}
                color="var(--mantine-color-cyan-7)"
              />
            ),
            field('placeName', <Text fw={500}>{v.placeName}</Text>),
          )}
          {line(
            <IconMapPin size={16} />,
            field(
              'address',
              <Text size="sm" c="dimmed">
                {v.address}
              </Text>,
            ),
          )}
          {line(
            <IconPhone size={16} />,
            field('phone', <Text size="sm">{v.phone}</Text>),
          )}
          {line(
            <IconPill size={16} />,
            field('products', <Text size="sm">{products}</Text>),
          )}

          {/* комментарий — со значком и обычным шрифтом, чтобы не путать с «нет …» */}
          {v.comment &&
            line(<IconMessage size={16} />, <Text size="sm">{v.comment}</Text>)}
          {(v.agreement || v.fact || v.deviation) && (
            <Text size="sm" c="dimmed">
              {[
                v.agreement && `Договорённость: ${v.agreement}`,
                v.fact && `факт: ${v.fact}`,
                v.deviation && `отклонение: ${v.deviation}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          )}
        </Stack>
      </Group>
    </Paper>
  );
}
