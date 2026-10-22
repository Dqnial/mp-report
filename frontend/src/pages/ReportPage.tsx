import {
  Alert,
  Button,
  Center,
  FileButton,
  Group,
  List,
  Loader,
  Paper,
  Select,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconSend,
  IconDownload,
  IconEye,
  IconUpload,
} from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SyncBadge } from '../components/SyncBadge';
import { UnfilledHint } from '../components/UnfilledHint';
import { isNative, nativeShareFile } from '../native';
import { unsentChanges } from '../plural';
import { takeSharedFile } from '../offline/shared';
import { pushOutbox } from '../offline/sync';
import {
  useSyncStatus,
  useReportCheck,
  useReportFile,
  useTemplates,
  useUploadTemplate,
} from '../api/queries';
import {
  addDays,
  formatMonth,
  monthOf,
  shiftWorkday,
  todayIso,
} from '../dates';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Скачать в «Загрузки» — только по явному нажатию (иначе мусор и «(1)» в имени). */
function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: file.name,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notifications.show({
    color: 'teal',
    message: 'Файл скачан — его можно отправить из «Загрузок»',
  });
}

/**
 * «Поделиться» → WhatsApp. Файл живёт только в памяти страницы — на устройство
 * ничего не сохраняется, имя уходит ровно исходное. share вызываем сразу в
 * обработчике нажатия (файл подготовлен заранее): иначе браузер отказывает
 * «Permission denied». Отказал всё равно — сообщаем, но сами не скачиваем.
 */
function shareReport(file: File, onFail: () => void) {
  // Android-приложение (APK): системное «Поделиться» умеет .xlsx, Chrome — нет
  if (isNative) {
    nativeShareFile(file, 'Отправить отчёт').catch(onFail);
    return;
  }
  if (!navigator.canShare?.({ files: [file] })) return onFail();
  navigator.share({ files: [file] }).catch((e: Error) => {
    if (e.name === 'AbortError') return; // закрыл меню «Поделиться»
    onFail();
  });
}

export function ReportPage() {
  const templates = useTemplates();
  const upload = useUploadTemplate();
  const sync = useSyncStatus();
  const current = monthOf(todayIso());
  const [picked, setPicked] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [shareFailed, setShareFailed] = useState(false);

  // Отчёт собирает сервер из того, что у него есть. Пока на телефоне есть
  // неотправленные визиты — сначала отправить их, иначе в файл они не попадут.
  const unsent = sync.pending;
  useEffect(() => {
    if (unsent) void pushOutbox();
  }, [unsent]);

  const months = [
    ...new Set([current, ...(templates.data ?? []).map((t) => t.month)]),
  ]
    .sort()
    .reverse();
  const month = picked ?? current;
  const template = templates.data?.find((t) => t.month === month);
  const check = useReportCheck(month, !!template && !unsent);
  const reportFile = useReportFile(month, check.data?.fileName);
  // пока проверка/файл обновляются, на экране может быть устаревшее
  const preparing = check.isFetching || reportFile.isFetching;

  const onUpload = (file: File | null) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (t) => {
        if (t.queued) {
          notifications.show({
            color: 'orange',
            title: 'Нет сети',
            message: `Шаблон «${file.name}» сохранён на телефоне и загрузится, когда появится сеть`,
          });
          return;
        }
        setPicked(t.month);
        const { created, linked } = t.imported;
        notifications.show({
          color: 'teal',
          title: `Шаблон на ${formatMonth(t.month)} загружен`,
          message:
            created + linked
              ? `Из файла прочитано визитов: ${created + linked} — они уже на экране «Визиты»`
              : `Рабочих дней: ${t.days}`,
        });
      },
    });
  };

  // файл из «Поделиться» (WhatsApp → Визиты МП) — загрузить сразу
  const sharedTaken = useRef(false);
  useEffect(() => {
    if (params.get('shared') === null || sharedTaken.current) return;
    sharedTaken.current = true;
    setParams({}, { replace: true });
    void takeSharedFile().then((file) => file && onUpload(file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  if (templates.isError) {
    return (
      <Stack gap="md">
        <Title order={2}>Отчёт</Title>
        <SyncBadge />
        <Alert color="gray" icon={<IconAlertTriangle />}>
          Нет связи с сервером. Отчёт собирается на сервере — отправить его
          можно, когда появится интернет. Визиты при этом сохраняются на
          телефоне.
        </Alert>
      </Stack>
    );
  }

  if (templates.isPending) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Title order={2}>Отчёт</Title>
      <SyncBadge />

      {months.length > 1 && (
        <Select
          label="Месяц"
          data={months.map((m) => ({ value: m, label: formatMonth(m) }))}
          value={month}
          onChange={setPicked}
          allowDeselect={false}
        />
      )}

      {!template ? (
        <Paper withBorder p="md">
          <Stack>
            <Text>
              Шаблон на <b>{formatMonth(month)}</b> ещё не загружен. Загрузите
              файл, который прислал руководитель.
            </Text>
            <FileButton onChange={onUpload} accept={`.xlsx,${XLSX_MIME}`}>
              {(props) => (
                <Button
                  {...props}
                  size="lg"
                  leftSection={<IconUpload />}
                  loading={upload.isPending}
                >
                  Загрузить шаблон
                </Button>
              )}
            </FileButton>
          </Stack>
        </Paper>
      ) : (
        <>
          <Paper withBorder p="md">
            <Stack gap="xs">
              <Text size="sm" c="dimmed">
                Файл
              </Text>
              <Text fw={500} style={{ wordBreak: 'break-word' }}>
                {template.originalName}
              </Text>
              {check.isFetching ? (
                <Loader size="sm" />
              ) : (
                check.data && (
                  <Text size="sm" c="dimmed">
                    Из приложения в файл попадёт визитов: {check.data.placed}
                    {check.data.total !== check.data.placed &&
                      ` из ${check.data.total}`}
                  </Text>
                )
              )}
            </Stack>
          </Paper>

          {!check.isFetching && check.data?.warnings.length ? (
            <Alert
              color="orange"
              icon={<IconAlertTriangle />}
              title="Обратите внимание"
            >
              <List size="sm" spacing={4}>
                {check.data.warnings.map((w) => (
                  <List.Item key={w}>{w}</List.Item>
                ))}
              </List>
            </Alert>
          ) : null}
          {unsent > 0 && (
            <Alert color="orange" icon={<IconAlertTriangle />}>
              {sync.offline || sync.authRequired
                ? `На телефоне ${unsentChanges(unsent)} — без них отчёт будет неполным. Подключитесь к интернету${sync.authRequired ? ' и войдите заново' : ''}.`
                : sync.errors
                  ? 'Сервер не принял часть визитов — откройте их в списке (значок ⚠) и исправьте.'
                  : 'Отправляю визиты с телефона на сервер…'}
            </Alert>
          )}
          {/* что не заполнено сегодня — подсказка, отправку не блокирует */}
          {month === current && <UnfilledHint />}
          {check.isError && <Alert color="red">{check.error.message}</Alert>}
          {reportFile.isError && (
            <Alert color="red">{reportFile.error.message}</Alert>
          )}

          <Button
            size="xl"
            color="green"
            leftSection={<IconSend size={28} />}
            loading={preparing || (unsent > 0 && sync.syncing)}
            disabled={!reportFile.data || unsent > 0}
            onClick={() => {
              setShareFailed(false);
              if (reportFile.data) {
                shareReport(reportFile.data, () => setShareFailed(true));
              }
            }}
          >
            Отправить отчёт
          </Button>

          {/* проверить, как лягут визиты, — не отправляя файл себе */}
          <Button
            component={Link}
            to={`/report/preview?date=${month === current ? todayIso() : shiftWorkday(addDays(`${month}-01`, -1), 1)}`}
            variant="light"
            size="lg"
            leftSection={<IconEye size={22} />}
          >
            Предпросмотр отчёта
          </Button>

          {shareFailed && reportFile.data && (
            <Alert color="orange" icon={<IconAlertTriangle />}>
              <Stack gap="xs">
                <Text size="sm">
                  {isNative
                    ? 'Не удалось открыть меню «Поделиться». Попробуйте ещё раз.'
                    : 'На этом устройстве не открылось меню «Поделиться». Можно скачать файл и отправить его вручную.'}
                </Text>
                {/* в APK скачивание blob-ссылок WebView не поддерживает */}
                {!isNative && (
                  <Button
                    variant="light"
                    color="orange"
                    leftSection={<IconDownload size={18} />}
                    onClick={() => download(reportFile.data!)}
                  >
                    Скачать файл
                  </Button>
                )}
              </Stack>
            </Alert>
          )}

          <Group justify="center" gap="xs">
            <FileButton onChange={onUpload} accept={`.xlsx,${XLSX_MIME}`}>
              {(props) => (
                <Button
                  {...props}
                  variant="subtle"
                  size="sm"
                  leftSection={<IconUpload size={18} />}
                  loading={upload.isPending}
                >
                  Заменить шаблон
                </Button>
              )}
            </FileButton>
            {!isNative && (
              <Button
                variant="subtle"
                size="sm"
                color="gray"
                leftSection={<IconDownload size={18} />}
                disabled={preparing || !reportFile.data || unsent > 0}
                onClick={() => reportFile.data && download(reportFile.data)}
              >
                Скачать файл
              </Button>
            )}
          </Group>
        </>
      )}

      {upload.isPending && (
        <Group gap="xs" justify="center" c="dimmed">
          <Loader size="xs" />
          <Text size="sm" c="dimmed">
            Загружаю шаблон и визиты из файла — до минуты…
          </Text>
        </Group>
      )}
      {upload.error && <Alert color="red">{upload.error.message}</Alert>}
    </Stack>
  );
}
