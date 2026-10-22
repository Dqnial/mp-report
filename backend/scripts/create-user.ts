// Создание пользователя: npm run user:create -- <login> <password> "<ФИО>" [--admin]
// Если логин уже есть — обновляет пароль, ФИО и признак админа.
// Обычно нужен один раз — для админа; остальные регистрируются по приглашениям.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const args = process.argv.slice(2);
  const isAdmin = args.includes('--admin');
  const [rawLogin, password, fullName] = args.filter((a) => a !== '--admin');
  const login = rawLogin?.trim().toLowerCase();

  if (!login || !password || !fullName) {
    console.error(
      'Использование: npm run user:create -- <login> <password> "<ФИО>" [--admin]',
    );
    process.exit(1);
  }
  if (!/^[a-z0-9._-]{3,32}$/.test(login)) {
    console.error(
      'Логин: 3–32 символа, латиница, цифры, точка, дефис, подчёркивание',
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Пароль должен быть не короче 8 символов');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { login },
      create: { login, passwordHash, fullName, isAdmin },
      update: { passwordHash, fullName, isAdmin },
    });
    // при смене пароля — разлогиниваем все устройства
    await prisma.session.deleteMany({ where: { userId: user.id } });
    console.log(
      `Пользователь ${user.login} (${user.fullName})${user.isAdmin ? ' [админ]' : ''} сохранён`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
