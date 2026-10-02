import {
	Client,
	IntentsBitField,
	REST,
	Routes,
	SlashCommandBuilder,
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ModalBuilder,
	TextInputBuilder,
	TextInputStyle,
	MessageFlags,
	Interaction,
	TextChannel,
	DMChannel,
	AttachmentBuilder,
} from 'discord.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GUILD_ID = '1555393892399185960';
const AUTO_DELETE_MS = 2 * 60 * 1000;
const CACHE_TTL = 30 * 1000;
const LOG_FILE = path.join(__dirname, 'auto-quest.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

// ============================================================
// EMOJIS — os IDs precisam existir em GUILD_ID
// ============================================================
const EMOJI_QUEST = '<:quest:1507595029873430620>';
const EMOJI_USER = '<:user:1507595145519038694>';
const EMOJI_ORBS = '<:orbs:1507594680995680286>';
const EMOJI_MAIN = '<:1202839238737272882:1550963452158414878>';
const EMOJI_DIRETOR = '<:diretor:1550967700656885841>';
const EMOJI_108 = '<:emoji_108:1550967704926687312>';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_ORB = '🔮';

// Botões — emojis animados
const EMOJI_LOGIN_STAR = '<a:501002flowingstar:1555258772098654329>';
const EMOJI_ROCKET_ANIM = '<a:270171rocket:1555258534441259148>';
const EMOJI_LIGHTNING_ANIM = '<a:653548lightning:1555258800301154374>';

const ROCKET_ID = '1555258534441259148';
const LIGHTNING_ID = '1555258800301154374';
const QUEST_ICON_ID = '1516711962061443114';

let ROCKET_BTN: { id?: string; name: string; animated?: boolean } = { name: '🚀' };
let LIGHTNING_BTN: { id?: string; name: string; animated?: boolean } = { name: '⚡' };

const BANNER_URL =
	'https://cdn.discordapp.com/attachments/1552448890656137297/1555470801904345108/1790923506283.jpg?backend=b2&ex=6ac0a492&is=6abf5312&hm=32123b4e477083c1ae208e41538c64230f08ac1d73a9eab19572c16650bac471&';
const LOGO_URL = process.env.LOGO_URL || BANNER_URL;

// ============================================================
// LOG
// ============================================================
function logToFile(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
	const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
	fsp.appendFile(LOG_FILE, line).catch(() => {});
	fsp.stat(LOG_FILE)
		.then((st) => {
			if (st.size > LOG_MAX_BYTES) {
				fsp.rename(LOG_FILE, LOG_FILE + '.old').catch(() => {});
			}
		})
		.catch(() => {});
}

// ============================================================
// FAKE PORT
// ============================================================
const PORT = process.env.PORT || 3000;
http
	.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('Auto Quest online');
	})
	.listen(PORT, () => console.log(`🌐 Fake server on port ${PORT}`));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
	console.error('❌ BOT_TOKEN missing!');
	process.exit(1);
}

// ============================================================
// AUTO-DELETE
// ============================================================
async function sendAutoDelete(
	channel: TextChannel | DMChannel | any,
	payload: any,
	delayMs: number = AUTO_DELETE_MS,
): Promise<any | null> {
	try {
		const msg = await channel.send(payload);
		if (!msg) return null;
		setTimeout(async () => {
			try {
				await msg.delete();
			} catch {}
		}, delayMs);
		return msg;
	} catch (e: any) {
		console.warn('⚠️ sendAutoDelete falhou:', e?.message ?? e);
		return null;
	}
}

// ============================================================
// STORAGE
// ============================================================
interface Account {
	token: string;
	username?: string;
	id?: string;
	avatar?: string;
	lastQuests?: number;
	lastOrbs?: number;
	lastUpdate?: string;
}

const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');
const MEMORY_STORE: Record<string, Account> = {};

function loadFromDisk(): Record<string, Account> {
	const result: Record<string, Account> = {};
	try {
		if (fs.existsSync(TOKEN_FILE)) {
			const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
			for (const [userId, val] of Object.entries(raw)) {
				if (typeof val === 'string') result[userId] = { token: val };
				else if (Array.isArray(val) && val[0]) result[userId] = val[0] as Account;
				else if (val && typeof val === 'object') result[userId] = val as Account;
			}
		}
	} catch (e) {
		console.error('⚠️ Erro lendo tokens:', e);
	}
	return result;
}

function persistToDisk(store: Record<string, Account>) {
	try {
		const dir = path.dirname(TOKEN_FILE);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
	} catch (e: any) {
		console.error('❌ Erro escrevendo:', e?.message ?? e);
	}
}

function getAccount(discordId: string): Account | null {
	if (MEMORY_STORE[discordId]) return MEMORY_STORE[discordId];
	const disk = loadFromDisk();
	if (disk[discordId]) {
		MEMORY_STORE[discordId] = disk[discordId];
		return disk[discordId];
	}
	return null;
}

function saveAccount(discordId: string, account: Account) {
	MEMORY_STORE[discordId] = account;
	const disk = loadFromDisk();
	disk[discordId] = account;
	persistToDisk(disk);
}

function removeAccount(discordId: string) {
	delete MEMORY_STORE[discordId];
	const disk = loadFromDisk();
	delete disk[discordId];
	persistToDisk(disk);
}

// ============================================================
// CHILD PROCESS
// ============================================================
type Mode = 'sequential_no_delay' | 'sequential_delay' | 'all_parallel' | 'all_delay' | 'profile' | 'orbs';

const activeChildren = new Map<string, any>();
const lastRun = new Map<string, number>();
const COOLDOWN_MS = 60 * 1000;

function runBot(
	token: string,
	mode: string,
	onLog: (line: string) => void,
	onDone: (code: number, output: string, error: string) => void,
) {
	const child = spawn('npx', ['tsx', 'bot.ts'], {
		cwd: __dirname,
		env: {
			...process.env,
			TOKEN: token,
			GITHUB_ACTIONS: 'false',
			QUEST_MODE: mode,
		},
	});

	let fullOutput = '';
	let errorOutput = '';

	let done = false;
	const safeDone = (code: number, out: string, err: string) => {
		if (done) return;
		done = true;
		onDone(code, out, err);
	};

	child.stdout.on('data', (d: Buffer) => {
		const s = d.toString();
		fullOutput += s;
		s.split('\n').filter(Boolean).forEach((line) => {
			console.log(line);
			onLog(line);
		});
	});

	child.stderr.on('data', (d: Buffer) => {
		const s = d.toString();
		errorOutput += s;
		s.split('\n').filter(Boolean).forEach((line) => {
			console.error(line);
			onLog('⚠️ ' + line);
		});
	});

	child.on('close', (code) => safeDone(code ?? 0, fullOutput, errorOutput));
	child.on('error', (err) => safeDone(1, fullOutput, err.message));

	setTimeout(() => {
		if (done) return;
		try { child.kill('SIGKILL'); } catch {}
		safeDone(124, fullOutput, 'watchdog timeout (3h)');
	}, 3 * 60 * 60 * 1000);

	return child;
}

// ============================================================
// BOT
// ============================================================
const client = new Client({
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.MessageContent,
	],
});

const runningUsers = new Set<string>();

const COLORS = {
	PURPLE: 0x8b5cf6,
	SUCCESS: 0x2ecc71,
	ERROR: 0xe74c3c,
	WARNING: 0xf1c40f,
	GREEN: 0x57f287,
	BLURPLE: 0x5865f2,
	ORB: 0x9b59b6,
};

const TASK_NAMES: Record<string, string> = {
	WATCH_VIDEO: '🎬 Assistir Vídeo',
	WATCH_VIDEO_ON_MOBILE: '📱 Vídeo Mobile',
	PLAY_ON_DESKTOP: '🎮 Jogar no Desktop',
	PLAY_ON_XBOX: '🎮 Jogar no Xbox',
	PLAY_ON_PLAYSTATION: '🎮 Jogar no PlayStation',
	PLAY_ACTIVITY: '🎯 Activity',
	STREAM_ON_DESKTOP: '📺 Stream',
	ACHIEVEMENT_IN_ACTIVITY: '🏆 Conquista',
};

// ============================================================
// PAINEL PRINCIPAL
// ============================================================
function mainPanelEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_QUEST}┃Auto Quest`)
		.setDescription(
			'```[+] Missões de vídeos:```\n' +
				'> Conclua as missões de vídeo do Discord de forma muito mais rápida e automatizada! Não é preciso manter o vídeo aberto, e o processo é até **6x mais rápido** do que assistir ao vídeo normalmente.\n\n' +
				'```[+] Missões de jogos:```\n' +
				'> Com o nosso sistema, as missões de jogos do Discord ficam muito mais fáceis, pois **não é necessário baixar, comprar ou jogar o jogo.** Nosso sistema simula o jogo mesmo sem você tê-lo ou estar jogando.\n\n' +
				'```[+] Missões de atividades:```\n' +
				'> O bot também conclui as missões das **Atividades do Discord**, os jogos e apps que rodam dentro das calls, de forma automática, **sem você precisar abrir ou jogar a atividade.**\n\n' +
				'━━━━━━━━━━━━━━━━━━━━━━\n' +
				`${EMOJI_USER}┃**Login** ⟶ Conecte sua conta do Discord\n` +
				`${EMOJI_QUEST}┃**Auto-Quest** ⟶ Execute missões automaticamente\n` +
				`${EMOJI_ORBS}┃**Orbs** ⟶ Consulte seu saldo de Orbs`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Sistema Automático', iconURL: LOGO_URL })
		.setTimestamp();
}

function mainPanelButtons(): ActionRowBuilder<ButtonBuilder>[] {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('login')
				.setLabel('Login')
				.setEmoji(EMOJI_LOGIN_STAR as any)
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('autoquest')
				.setLabel('Auto-Quest')
				.setEmoji(EMOJI_ROCKET_ANIM as any)
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('orbs')
				.setLabel('Orbs')
				.setEmoji(EMOJI_ORBS as any)
				.setStyle(ButtonStyle.Secondary)
		),
	];
}

function modeSelectButtons(): ActionRowBuilder<ButtonBuilder>[] {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('mode_sequential_no_delay')
				.setLabel('1 por 1 (rápido)')
				.setEmoji(ROCKET_BTN)
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId('mode_sequential_delay')
				.setLabel('1 por 1 (delay 3min)')
				.setEmoji(ROCKET_BTN)
				.setStyle(ButtonStyle.Primary)
		),
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('mode_all_parallel')
				.setLabel('Todas de vez')
				.setEmoji(LIGHTNING_BTN)
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId('mode_all_delay')
				.setLabel('Todas c/ delay')
				.setEmoji(LIGHTNING_BTN)
				.setStyle(ButtonStyle.Secondary)
		),
	];
}

function addTokenModal(): ModalBuilder {
	const modal = new ModalBuilder().setCustomId('modal_add_token').setTitle('Login — token da conta');
	modal.addComponents(
		new ActionRowBuilder<TextInputBuilder>().addComponents(
			new TextInputBuilder()
				.setCustomId('input_token')
				.setLabel('Token da conta (nunca compartilhe)')
				.setPlaceholder('Cole o token da sua conta Discord...')
				.setStyle(TextInputStyle.Paragraph)
				.setMinLength(30)
				.setMaxLength(200)
				.setRequired(true)
		)
	);
	return modal;
}

// ============================================================
// EMBEDS DO LOGIN / ORBS / ERRO
// ============================================================

// ✅ Embed "Verificando token..."
function verifyingTokenEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Login', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_LIGHTNING} Verificando token...`)
		.setDescription(
			`${EMOJI_108} Aguarde enquanto eu conecto sua conta à API do Discord.`
		)
		.setColor(COLORS.WARNING)
		.setFooter({ text: 'Auto Quest • Autenticando', iconURL: LOGO_URL })
		.setTimestamp();
}

// ✅ Embed de LOGIN REALIZADO — usa avatar/id/username REAIS do /users/@me
function loginSuccessEmbed(info: ProfileInfo): EmbedBuilder {
	const avatarUrl = info.avatar
		? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=256`
		: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(info.id) >> 22n) % 6n)}.png`;

	const createdAt = new Date(Number((BigInt(info.id) >> 22n) + 1420070400000n));
	const createdTs = Math.floor(createdAt.getTime() / 1000);

	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Login', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_MAIN}┃Login Realizado`)
		.setDescription(
			'**Sua conta foi conectada com sucesso.**\n\n' +
				`${EMOJI_USER} **Nome:** \`${info.global_name ?? info.username}\`\n` +
				`${EMOJI_108} **Username:** \`${info.username}\`\n` +
				`${EMOJI_108} **ID:** \`${info.id}\`\n` +
				`${EMOJI_ORBS} **Orbs:** \`${info.orbs ?? 0}\`\n` +
				`${EMOJI_LIGHTNING} **Quests disponíveis:** \`${info.quests}\`\n\n` +
				`📅 Conta criada <t:${createdTs}:R>`
		)
		.setColor(COLORS.GREEN)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Conta conectada', iconURL: LOGO_URL })
		.setTimestamp();
}

// ✅ Embed de TOKEN INCORRETO
function tokenWrongEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Erro de Token', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_108}┃Token Incorreto`)
		.setDescription(
			'**Você só pode adicionar o token da sua própria conta!**\n\n' +
				`${EMOJI_DIRETOR} **Verifique se:**\n` +
				`${EMOJI_108} O token foi copiado corretamente (sem \`Bot \` no início)\n` +
				`${EMOJI_108} Não há espaços ou quebras de linha\n` +
				`${EMOJI_108} O token ainda é válido (não expirou)`
		)
		.setColor(COLORS.BLURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Token Inválido', iconURL: LOGO_URL })
		.setTimestamp();
}

// ✅ Embed de ORBS
function orbsEmbed(
	accountName: string,
	totalOrbs: number,
	breakdown: { name: string; orbs: number }[]
): EmbedBuilder {
	const lines = breakdown.length
		? breakdown.map((b) => `${EMOJI_108} **${b.name}** — \`${b.orbs}\` Orbs`).join('\n')
		: `${EMOJI_108} Nenhuma quest com Orbs no momento.`;

	return new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_ORBS}┃Saldo de Orbs`)
		.setDescription(
			`**Total acumulado:** ${EMOJI_ORB} \`${totalOrbs}\` Orbs\n\n` +
				`**Detalhamento por quest:**\n${lines}`
		)
		.setColor(COLORS.ORB)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Orbs', iconURL: LOGO_URL })
		.setTimestamp();
}

// ============================================================
// PROFILE / STATS / LIVE
// ============================================================
interface ProfileInfo {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	quests: number;
	orbs?: number;
}

function profileEmbed(info: ProfileInfo, cached = false): EmbedBuilder {
	const avatarUrl = info.avatar
		? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=256`
		: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(info.id) >> 22n) % 6n)}.png`;

	const createdAt = new Date(Number((BigInt(info.id) >> 22n) + 1420070400000n));
	const createdTs = Math.floor(createdAt.getTime() / 1000);
	const accountAge = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

	return new EmbedBuilder()
		.setAuthor({
			name: cached ? `${EMOJI_DIRETOR} Perfil (cache)` : `${EMOJI_DIRETOR} Perfil`,
			iconURL: avatarUrl,
		})
		.setTitle(`${EMOJI_MAIN} ${info.global_name ?? info.username}`)
		.setDescription(
			`${EMOJI_108} **Nick:** \`${info.username}\`\n` +
				`${EMOJI_108} **ID:** \`${info.id}\`\n` +
				`${EMOJI_ORBS} **Orbs:** \`${info.orbs ?? 0}\`\n\n` +
				`${EMOJI_LIGHTNING} **Quests disponíveis:** \`${info.quests}\``
		)
		.addFields(
			{ name: '📅 Criada em', value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`, inline: false },
			{ name: '🕒 Idade da conta', value: `${accountAge} dias`, inline: true },
			{ name: '📊 Status', value: cached ? '⚠️ Cache' : '✅ Ativa e conectada', inline: true }
		)
		.setColor(cached ? COLORS.WARNING : COLORS.SUCCESS)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
		.setTimestamp();
}

function statsEmbed(acc: Account): EmbedBuilder {
	const avatarUrl = acc.avatar
		? `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png?size=256`
		: acc.id
		? `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(acc.id) >> 22n) % 6n)}.png`
		: LOGO_URL;

	return new EmbedBuilder()
		.setAuthor({ name: `${EMOJI_DIRETOR} Estatísticas`, iconURL: avatarUrl })
		.setTitle(`${EMOJI_MAIN} @${acc.username ?? 'conta'}`)
		.setDescription(
			`${EMOJI_108} **ID:** \`${acc.id ?? 'desconhecido'}\`\n` +
				`${EMOJI_108} **Última execução:** ${
					acc.lastUpdate ? `<t:${Math.floor(new Date(acc.lastUpdate).getTime() / 1000)}:R>` : 'nunca'
				}\n` +
				`${EMOJI_108} **Última contagem:** \`${acc.lastQuests ?? 0}\` quests\n` +
				`${EMOJI_ORBS} **Último saldo de Orbs:** \`${acc.lastOrbs ?? 0}\`\n` +
				`${EMOJI_108} **Token:** ${acc.token ? '✅ salvo' : '❌ ausente'}`
		)
		.setColor(COLORS.PURPLE)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Stats', iconURL: LOGO_URL })
		.setTimestamp();
}

// ============================================================
// READY — registra comandos
// ============================================================
client.once('ready', async () => {
	console.log(`✅ ${client.user?.tag} online`);
	logToFile('INFO', `Bot online: ${client.user?.tag}`);

	try {
		const e1 = await client.emojis.fetch(ROCKET_ID);
		ROCKET_BTN = { id: e1.id, name: e1.name!, animated: e1.animated ?? false };
	} catch {
		ROCKET_BTN = { name: '🚀' };
	}
	try {
		const e2 = await client.emojis.fetch(LIGHTNING_ID);
		LIGHTNING_BTN = { id: e2.id, name: e2.name!, animated: e2.animated ?? false };
	} catch {
		LIGHTNING_BTN = { name: '⚡' };
	}

	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar o token da sua conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover seu token'),
		new SlashCommandBuilder().setName('stats').setDescription('Ver suas estatísticas'),
		new SlashCommandBuilder().setName('perfil').setDescription('Ver perfil da conta logada'),
		new SlashCommandBuilder().setName('orbs').setDescription('Ver seu saldo de Orbs'),
		new SlashCommandBuilder().setName('ping').setDescription('Status do bot'),
		new SlashCommandBuilder().setName('logs').setDescription('Ver últimas linhas do log'),
	].map((c) => c.toJSON());

	const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
	try {
		await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), { body: [] });
		const data = (await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), {
			body: commands,
		})) as any[];
		console.log(`✅ ${data.length} comandos registrados`);
	} catch (e: any) {
		console.error('❌ Erro registrando:', e?.message);
	}
});

// ============================================================
// VERIFY ACCOUNT (busca perfil + quests + orbs)
// ============================================================
async function verifyAccount(token: string): Promise<ProfileInfo | null> {
	return new Promise((resolve) => {
		let profileJson: string | null = null;
		let finished = false;
		let timeoutHandle: NodeJS.Timeout | null = null;

		const finish = (val: ProfileInfo | null) => {
			if (finished) return;
			finished = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			resolve(val);
		};

		let child: ReturnType<typeof runBot> | null = null;
		try {
			child = runBot(
				token,
				'profile',
				(line) => {
					const m = line.match(/__PROFILE_JSON_START__(.+?)__PROFILE_JSON_END__/);
					if (m) {
						profileJson = m[1];
						console.log(`   ✅ Perfil capturado: ${profileJson.slice(0, 80)}`);
					}
				},
				() => {
					if (!profileJson) return finish(null);
					try {
						finish(JSON.parse(profileJson));
					} catch {
						finish(null);
					}
				}
			);
		} catch (e) {
			console.error('Erro spawnando bot.ts:', e);
			return finish(null);
		}

		timeoutHandle = setTimeout(() => {
			if (finished) return;
			try { child?.kill('SIGTERM'); } catch {}
			setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, 5000);
			if (profileJson) {
				try { finish(JSON.parse(profileJson)); } catch { finish(null); }
			} else {
				finish(null);
			}
		}, 180 * 1000);
	});
}

// ✅ Busca orbs via bot.ts em modo 'orbs'
async function fetchOrbs(token: string): Promise<{ total: number; breakdown: { name: string; orbs: number }[] } | null> {
	return new Promise((resolve) => {
		let orbsJson: string | null = null;
		let finished = false;
		let timeoutHandle: NodeJS.Timeout | null = null;

		const finish = (val: any) => {
			if (finished) return;
			finished = true;
			if (timeoutHandle) clearTimeout(timeoutHandle);
			resolve(val);
		};

		let child: ReturnType<typeof runBot> | null = null;
		try {
			child = runBot(
				token,
				'orbs',
				(line) => {
					const m = line.match(/__ORBS_JSON_START__(.+?)__ORBS_JSON_END__/);
					if (m) {
						orbsJson = m[1];
						console.log(`   ✅ Orbs capturados: ${orbsJson.slice(0, 80)}`);
					}
				},
				() => {
					if (!orbsJson) return finish(null);
					try { finish(JSON.parse(orbsJson)); } catch { finish(null); }
				}
			);
		} catch (e) {
			console.error('Erro spawnando bot.ts (orbs):', e);
			return finish(null);
		}

		timeoutHandle = setTimeout(() => {
			if (finished) return;
			try { child?.kill('SIGTERM'); } catch {}
			setTimeout(() => { try { child?.kill('SIGKILL'); } catch {} }, 5000);
			if (orbsJson) {
				try { finish(JSON.parse(orbsJson)); } catch { finish(null); }
			} else {
				finish(null);
			}
		}, 60 * 1000);
	});
}

// ============================================================
// VALIDAÇÃO DE TOKEN
// ============================================================
function isValidDiscordToken(token: string): boolean {
	if (!token) return false;
	const clean = token.trim().replace(/^Bot\s+/i, '');
	const parts = clean.split('.');
	if (parts.length !== 3) return false;
	if (parts.some((p) => p.length < 3)) return false;
	if (/\s/.test(clean)) return false;
	return true;
}

// ============================================================
// HANDLE LOGIN
// ============================================================
async function handleLogin(interaction: any, user: any, token: string) {
	token = token.trim().replace(/^Bot\s+/i, '').replace(/\s+/g, '');

	console.log(
		`🔍 Token recebido: len=${token.length} parts=${token.split('.').length} prefix=${token.slice(0, 6)}...`
	);

	// ✅ 1) Validação básica de formato
	if (!isValidDiscordToken(token)) {
		await interaction.reply({
			embeds: [tokenWrongEmbed()],
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	// ✅ 2) Responde "verificando" com embed
	try {
		await interaction.reply({
			embeds: [verifyingTokenEmbed()],
			flags: MessageFlags.Ephemeral,
		});
	} catch (e) {
		console.error('reply falhou:', e);
		return;
	}

	const existing = getAccount(user.id);

	// ✅ 3) Verifica token de verdade via /users/@me
	console.log(`🔍 Verificando token para ${user.tag}...`);
	const info = await verifyAccount(token);

	if (info) {
		// ✅ 4) Busca orbs reais via /quests/@me
		const orbsData = await fetchOrbs(token);
		info.orbs = orbsData?.total ?? 0;

		// ✅ 5) Salva conta
		saveAccount(user.id, {
			...(existing ?? {}),
			token,
			username: info.username,
			id: info.id,
			avatar: info.avatar ?? undefined,
			lastQuests: info.quests,
			lastOrbs: info.orbs,
			lastUpdate: new Date().toISOString(),
		});

		// ✅ 6) Edita mensagem com embed de sucesso
		try {
			await interaction.editReply({
				embeds: [loginSuccessEmbed(info)],
			});
		} catch (e) {
			console.error('editReply sucesso falhou:', e);
		}
		logToFile('INFO', `Login OK: ${user.tag} -> @${info.username}`);
		return;
	}

	// Fallback: mostra cache se tiver
	if (existing?.username && existing?.id) {
		const cachedInfo: ProfileInfo = {
			id: existing.id,
			username: existing.username,
			global_name: null,
			avatar: existing.avatar ?? null,
			quests: existing.lastQuests ?? 0,
			orbs: existing.lastOrbs ?? 0,
		};
		try {
			await interaction.editReply({
				embeds: [profileEmbed(cachedInfo, true)],
			});
		} catch (e) {
			console.error('editReply cache falhou:', e);
		}
		return;
	}

	// ✅ Token inválido de verdade
	try {
		await interaction.editReply({
			embeds: [tokenWrongEmbed()],
		});
	} catch (e) {
		console.error('editReply token errado falhou:', e);
	}
}

// ============================================================
// HANDLE ORBS
// ============================================================
async function handleOrbs(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({
			content: '❌ Faça login primeiro.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('deferReply orbs falhou:', e);
		return;
	}

	await interaction.editReply({
		embeds: [
			new EmbedBuilder()
				.setTitle(`${EMOJI_LIGHTNING} Buscando Orbs...`)
				.setDescription(`${EMOJI_108} Consultando \`/quests/@me\` da sua conta.`)
				.setColor(COLORS.WARNING)
				.setTimestamp(),
		],
	});

	const orbsData = await fetchOrbs(acc.token);

	if (!orbsData) {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(`${EMOJI_108}┃Falha ao buscar Orbs`)
					.setDescription('Não consegui consultar a API do Discord. Tente novamente.')
					.setColor(COLORS.ERROR)
					.setTimestamp(),
			],
		});
		return;
	}

	saveAccount(user.id, { ...acc, lastOrbs: orbsData.total });

	await interaction.editReply({
		embeds: [orbsEmbed(acc.username ?? 'conta', orbsData.total, orbsData.breakdown)],
	});
}

// ============================================================
// INTERACTIONS
// ============================================================
client.on('interactionCreate', async (interaction: Interaction) => {
	try {
		if (interaction.isChatInputCommand()) {
			const { commandName, user } = interaction;

			if (commandName === 'painel') {
				await interaction.reply({
					embeds: [mainPanelEmbed()],
					components: mainPanelButtons(),
				});
				return;
			}

			if (commandName === 'token') {
				const tk = interaction.options.getString('token', true).trim();
				await handleLogin(interaction, user, tk);
				return;
			}

			if (commandName === 'orbs') {
				await handleOrbs(interaction, user);
				return;
			}

			if (commandName === 'deltoken') {
				removeAccount(user.id);
				await interaction.reply({ content: '🗑️ Token removido.', flags: MessageFlags.Ephemeral });
				return;
			}

			if (commandName === 'stats') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
					return;
				}
				await interaction.reply({ embeds: [statsEmbed(acc)], flags: MessageFlags.Ephemeral });
				return;
			}

			if (commandName === 'perfil') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
					return;
				}
				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const info = await verifyAccount(acc.token);
				if (info) {
					const orbsData = await fetchOrbs(acc.token);
					info.orbs = orbsData?.total ?? 0;
					saveAccount(user.id, {
						...acc,
						username: info.username,
						id: info.id,
						avatar: info.avatar ?? undefined,
						lastQuests: info.quests,
						lastOrbs: info.orbs,
						lastUpdate: new Date().toISOString(),
					});
					await interaction.editReply({ embeds: [profileEmbed(info, false)] });
				} else if (acc.username && acc.id) {
					const cachedInfo: ProfileInfo = {
						id: acc.id,
						username: acc.username,
						global_name: null,
						avatar: acc.avatar ?? null,
						quests: acc.lastQuests ?? 0,
						orbs: acc.lastOrbs ?? 0,
					};
					await interaction.editReply({ embeds: [profileEmbed(cachedInfo, true)] });
				} else {
					await interaction.editReply({ embeds: [tokenWrongEmbed()] });
				}
				return;
			}
		}

		if (interaction.isButton()) {
			const { customId, user } = interaction;

			if (customId === 'login') {
				await interaction.showModal(addTokenModal());
				return;
			}

			if (customId === 'autoquest') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
					return;
				}
				await interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: `${EMOJI_DIRETOR} Auto Quest • Modo`, iconURL: LOGO_URL })
							.setTitle(`${EMOJI_MAIN} Escolha o modo`)
							.setDescription(
								`${EMOJI_108} 🚀 **1 por 1 (rápido)** — Sem delay\n` +
									`${EMOJI_108} 🚀 **1 por 1 (delay 3min)** — Recomendado\n` +
									`${EMOJI_108} ⚡ **Todas de vez** — Paralelo\n` +
									`${EMOJI_108} ⚡ **Todas c/ delay** — Série`
							)
							.setColor(COLORS.PURPLE)
							.setImage(BANNER_URL)
							.setTimestamp(),
					],
					components: modeSelectButtons(),
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (customId === 'orbs') {
				await handleOrbs(interaction, user);
				return;
			}

			if (customId === 'cancel_quest') {
				const child = activeChildren.get(user.id);
				if (child) {
					try { child.kill('SIGTERM'); } catch {}
					setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
					activeChildren.delete(user.id);
					runningUsers.delete(user.id);
					await interaction.reply({ content: '🛑 Cancelado.', flags: MessageFlags.Ephemeral });
				} else {
					await interaction.reply({ content: '❌ Nada em execução.', flags: MessageFlags.Ephemeral });
				}
				return;
			}

			if (customId.startsWith('mode_')) {
				const mode = customId.replace('mode_', '') as Mode;
				// ... seu handler de auto-quest original continua aqui ...
				await interaction.reply({
					content: `⏳ Iniciando em modo \`${mode}\`... (handler de quest original)`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
		}

		if (interaction.isModalSubmit()) {
			if (interaction.customId === 'modal_add_token') {
				const tk = interaction.fields.getTextInputValue('input_token').trim();
				await handleLogin(interaction, interaction.user, tk);
				return;
			}
		}
	} catch (err: any) {
		console.error('❌ interactionCreate error:', err?.message ?? err);
		logToFile('ERROR', `interactionCreate: ${err?.message}`);
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: '❌ Erro interno.', flags: MessageFlags.Ephemeral });
			}
		} catch {}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));
