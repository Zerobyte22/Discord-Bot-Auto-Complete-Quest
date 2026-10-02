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
	StringSelectMenuBuilder,
	StringSelectMenuOptionBuilder,
	MessageFlags,
	Interaction,
	ChannelType,
	ActivityType,
} from 'discord.js';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIG
// ============================================================
const GUILD_ID = '1555393892399185960';
const ALLOWED_CHANNEL = '1555610749647200366';
const OWNER_ID = '1508337872254795877';
const AUTO_DELETE_MS = 2 * 60 * 1000;
const LOG_FILE = path.join(__dirname, 'auto-quest.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const BATCH_DELAY_MS = 3 * 60 * 1000;

// ============================================================
// STATUS
// ============================================================
const STATUS_TYPE: 'PLAYING' | 'WATCHING' | 'LISTENING' | 'COMPETING' = 'WATCHING';
const STATUS_TEXT = '🔍 Auto Quest • /painel';

// ============================================================
// EMOJIS
// ============================================================
const EMOJI_MAIN = '🚀';
const EMOJI_USER = '👤';
const EMOJI_ORBS = '🔮';
const EMOJI_ORB = '🔮';
const EMOJI_DIRETOR = '📋';
const EMOJI_108 = '▫️';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_GHOST = '👻';
const EMOJI_LOCK = '🔒';
const EMOJI_UNLOCK = '🔓';
const EMOJI_QUEUE = '⏳';
const EMOJI_CHECK = '✅';
const EMOJI_CROSS = '❌';
const EMOJI_WARN = '⚠️';
const EMOJI_DM = '📬';
const EMOJI_QUEST = '🔍';
const EMOJI_BATCH = '⚡';

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
// STORAGE
// ============================================================
interface QuestSummary {
	id: string;
	name: string;
	game: string;
	publisher: string;
	hero: string | null;
	tile: string | null;
	task: string;
	orbs: number;
	current: number;
	total: number;
	expiresAt: string | null;
	cosponsor: string | null;
	primaryColor: string | null;
	rewardName: string | null;
	rewardAsset: string | null;
	startsAt: string | null;
}

interface Account {
	token: string;
	username?: string;
	id?: string;
	avatar?: string;
	lastQuests?: number;
	lastOrbs?: number;
	lastUpdate?: string;
	questsList?: QuestSummary[];
	tokenExpired?: boolean;
	expiredNotified?: boolean;
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
const activeChildren = new Map<string, any>();
const lastRun = new Map<string, number>();
const COOLDOWN_MS = 3 * 60 * 1000;
const finishedExecutions = new Set<string>();

function runBot(
	token: string,
	mode: string,
	onLog: (line: string) => void,
	onDone: (code: number, output: string, error: string) => void,
	extraEnv: Record<string, string> = {},
) {
	const child = spawn('npx', ['tsx', 'bot.ts'], {
		cwd: __dirname,
		env: {
			...process.env,
			TOKEN: token,
			GITHUB_ACTIONS: 'false',
			QUEST_MODE: mode,
			...extraEnv,
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
		s.split('\n')
			.filter(Boolean)
			.forEach((line) => {
				console.log(line);
				onLog(line);
			});
	});

	child.stderr.on('data', (d: Buffer) => {
		const s = d.toString();
		errorOutput += s;
		s.split('\n')
			.filter(Boolean)
			.forEach((line) => {
				console.error(line);
				onLog('⚠️ ' + line);
			});
	});

	child.on('close', (code) => safeDone(code ?? 0, fullOutput, errorOutput));
	child.on('error', (err) => safeDone(1, fullOutput, err.message));

	setTimeout(() => {
		if (done) return;
		try {
			child.kill('SIGKILL');
		} catch {}
		safeDone(124, fullOutput, 'watchdog timeout');
	}, 3 * 60 * 60 * 1000);

	return child;
}

// ============================================================
// BOT CLIENT
// ============================================================
const client = new Client({
	intents: [
		IntentsBitField.Flags.Guilds,
		IntentsBitField.Flags.GuildMessages,
		IntentsBitField.Flags.MessageContent,
		IntentsBitField.Flags.DirectMessages,
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
	VIDEO: 0xeb459e,
	GAME: 0x3498db,
	QUEUE: 0xfee75c,
};

const TASK_EMOJI: Record<string, string> = {
	WATCH_VIDEO: '🎬',
	WATCH_VIDEO_ON_MOBILE: '📱',
	PLAY_ON_DESKTOP: '🎮',
	PLAY_ON_XBOX: '🎮',
	PLAY_ON_PLAYSTATION: '🎮',
	PLAY_ACTIVITY: '🎯',
	STREAM_ON_DESKTOP: '📺',
	ACHIEVEMENT_IN_ACTIVITY: '🏆',
};

const TASK_LABEL: Record<string, string> = {
	WATCH_VIDEO: 'Vídeo',
	WATCH_VIDEO_ON_MOBILE: 'Vídeo Mobile',
	PLAY_ON_DESKTOP: 'Jogo (Desktop)',
	PLAY_ON_XBOX: 'Jogo (Xbox)',
	PLAY_ON_PLAYSTATION: 'Jogo (PlayStation)',
	PLAY_ACTIVITY: 'Atividade',
	STREAM_ON_DESKTOP: 'Stream',
	ACHIEVEMENT_IN_ACTIVITY: 'Conquista',
};

function isVideoTask(task: string): boolean {
	return task === 'WATCH_VIDEO' || task === 'WATCH_VIDEO_ON_MOBILE';
}

// ============================================================
// EMBEDS
// ============================================================
function mainPanelEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_QUEST}┃Auto Quest`)
		.setDescription(
			'```[+] Missões de vídeos:```\n' +
				'> Conclua as missões de vídeo do Discord de forma muito mais rápida e automatizada! Não é preciso manter o vídeo aberto, e o processo é até **6x mais rápido**.\n\n' +
				'```[+] Missões de jogos:```\n' +
				'> As missões de jogos ficam muito mais fáceis, pois **não é necessário baixar, comprar ou jogar o jogo.** Nosso sistema simula o jogo mesmo sem você tê-lo.\n\n' +
				'```[+] Missões de atividades:```\n' +
				'> O bot também conclui as missões das **Atividades do Discord**, os jogos e apps que rodam dentro das calls, de forma automática.\n' +
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
			new ButtonBuilder().setCustomId('login').setLabel('Login').setEmoji('🌟').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('autoquest').setLabel('Auto-Quest').setEmoji('🚀').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId('orbs').setLabel('Orbs').setEmoji('🔮').setStyle(ButtonStyle.Secondary)
		),
	];
}

function verifyingTokenEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Login', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_LIGHTNING} Verificando token...`)
		.setDescription(`${EMOJI_108} Conectando sua conta à API do Discord.`)
		.setColor(COLORS.WARNING)
		.setTimestamp();
}

interface ProfileInfo {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	quests: number;
	orbs?: number;
	questsList?: QuestSummary[];
	expired?: boolean;
}

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
				`${EMOJI_ORBS} **Orbs disponíveis:** \`${info.orbs ?? 0}\`\n` +
				`${EMOJI_LIGHTNING} **Quests ativas:** \`${info.quests}\`\n\n` +
				`📅 Conta criada <t:${createdTs}:R>`
		)
		.setColor(COLORS.GREEN)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Conta conectada', iconURL: LOGO_URL })
		.setTimestamp();
}

function tokenWrongEmbed(reason?: string): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Erro de Token', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_GHOST}┃Token Incorreto`)
		.setDescription(
			(reason ? `**${reason}**\n\n` : '**Você só pode adicionar o token da sua própria conta!**\n\n') +
				`${EMOJI_DIRETOR} **Verifique se:**\n` +
				`${EMOJI_108} O token foi copiado corretamente\n` +
				`${EMOJI_108} Não há espaços ou quebras de linha\n` +
				`${EMOJI_108} O token ainda é válido (não expirou)`
		)
		.setColor(COLORS.BLURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Token Inválido', iconURL: LOGO_URL })
		.setTimestamp();
}

function tokenExpiredEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Token Expirado', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_WARN}┃Token Expirado`)
		.setDescription(
			'**O token salvo expirou ou foi revogado.**\n\n' +
				`${EMOJI_108} Faça \`/token\` novamente com um token novo\n` +
				`${EMOJI_108} Tokens expiram quando você troca a senha ou o Discord revoga por segurança`
		)
		.setColor(COLORS.ERROR)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Reautentique', iconURL: LOGO_URL })
		.setTimestamp();
}

function questSelectEmbed(info: ProfileInfo): EmbedBuilder {
	const quests = info.questsList ?? [];

	const lines = quests.length
		? quests
				.map((q) => {
					const emoji = TASK_EMOJI[q.task] ?? '🎯';
					const tipo = isVideoTask(q.task) ? 'Vídeo' : 'Jogo/Atividade';
					const orbs = q.orbs > 0 ? `${EMOJI_ORB} \`${q.orbs}\`` : 'sem orbs';
					return (
						`${emoji} **${q.name}**\n` +
						`   ┣ ${EMOJI_DIRETOR} Tipo: **${tipo}**\n` +
						`   ┣ ${EMOJI_108} Progresso: \`${q.current}/${q.total}\`\n` +
						`   ┗ ${EMOJI_ORBS} Orbs: ${orbs}`
					);
				})
				.join('\n\n')
		: `${EMOJI_108} Nenhuma quest disponível no momento.`;

	return new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${info.username}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_MAIN}┃Selecione uma Quest`)
		.setDescription(
			`${EMOJI_DIRETOR} Encontrei **${quests.length}** quest(s) ativa(s):\n\n` +
				lines +
				`\n\n${EMOJI_108} Use o menu abaixo ou clique em **Fazer Todas**.`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Seletor', iconURL: LOGO_URL })
		.setTimestamp();
}

function questSelectMenu(info: ProfileInfo): ActionRowBuilder<StringSelectMenuBuilder>[] {
	const quests = info.questsList ?? [];
	if (quests.length === 0) return [];

	const menu = new StringSelectMenuBuilder()
		.setCustomId('select_quest')
		.setPlaceholder('🎯 Escolha uma quest para executar...')
		.setMinValues(1)
		.setMaxValues(1);

	for (const q of quests.slice(0, 25)) {
		const tipo = isVideoTask(q.task) ? 'Vídeo' : 'Jogo';
		const orbs = q.orbs > 0 ? `${q.orbs} Orbs` : 'sem Orbs';

		menu.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel(q.name.slice(0, 95))
				.setDescription(`${tipo} • ${orbs} • ${q.current}/${q.total}`.slice(0, 95))
				.setValue(q.id)
		);
	}

	return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

function questSelectButtons(hasQuests: boolean): ActionRowBuilder<ButtonBuilder>[] {
	if (!hasQuests) return [];
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('run_all_quests')
				.setLabel('Fazer Todas')
				.setEmoji('⚡')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId('back_to_panel')
				.setLabel('Voltar')
				.setEmoji('↩️')
				.setStyle(ButtonStyle.Secondary)
		),
	];
}

function questDetailEmbed(q: QuestSummary, accountName: string): EmbedBuilder {
	const isVideo = isVideoTask(q.task);
	const color = q.primaryColor
		? parseInt(q.primaryColor.replace('#', ''), 16)
		: isVideo
		? COLORS.VIDEO
		: COLORS.GAME;

	const lines: string[] = [];
	lines.push(`${EMOJI_DIRETOR} **Publisher:** ${q.publisher}`);
	lines.push(`${EMOJI_108} **Jogo:** ${q.game}`);
	lines.push(`${TASK_EMOJI[q.task] ?? '🎯'} **Tipo:** ${TASK_LABEL[q.task] ?? q.task}`);
	if (q.cosponsor) lines.push(`🤝 **Co-sponsor:** ${q.cosponsor}`);
	if (q.orbs > 0) lines.push(`${EMOJI_ORB} **Recompensa:** \`${q.orbs}\` Orbs`);
	if (q.rewardName) lines.push(`🎁 **Prêmio:** ${q.rewardName}`);
	lines.push(`\n**Progresso:**\n${progressBar(q.current, q.total)}`);
	lines.push(`\n⏱️ ${q.current}/${q.total}`);

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_MAIN} ${q.name}`)
		.setDescription(lines.join('\n'))
		.setColor(color)
		.setFooter({ text: 'Auto Quest • Confirmação', iconURL: LOGO_URL })
		.setTimestamp();

	if (q.hero) embed.setImage(`https://cdn.discordapp.com/${q.hero}`);
	if (q.tile) embed.setThumbnail(`https://cdn.discordapp.com/${q.tile}`);

	if (q.startsAt && q.expiresAt) {
		const startTs = Math.floor(new Date(q.startsAt).getTime() / 1000);
		const expiresTs = Math.floor(new Date(q.expiresAt).getTime() / 1000);
		embed.addFields(
			{ name: '🕐 Iniciada', value: `<t:${startTs}:R>`, inline: true },
			{ name: '⏰ Expira', value: `<t:${expiresTs}:R>`, inline: true }
		);
	}

	return embed;
}

function questDetailButtons(questId: string): ActionRowBuilder<ButtonBuilder>[] {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`execute_quest_${questId}`)
				.setLabel('Executar Quest')
				.setEmoji('🚀')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId('back_to_select')
				.setLabel('Voltar')
				.setEmoji('↩️')
				.setStyle(ButtonStyle.Secondary)
		),
	];
}

function progressBar(current: number, total: number, length = 15): string {
	const safeTotal = total > 0 ? total : 1;
	const percent = Math.min(100, Math.round((current / safeTotal) * 100));
	const filled = Math.round((percent / 100) * length);
	const empty = length - filled;
	return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${percent}%**`;
}

function liveQuestEmbed(q: QuestSummary, accountName: string): EmbedBuilder {
	const isVideo = isVideoTask(q.task);
	const color = q.primaryColor
		? parseInt(q.primaryColor.replace('#', ''), 16)
		: isVideo
		? COLORS.VIDEO
		: COLORS.GAME;

	const lines: string[] = [];
	lines.push(`${EMOJI_DIRETOR} **Publisher:** ${q.publisher}`);
	if (q.game) lines.push(`${EMOJI_108} **Jogo:** ${q.game}`);
	lines.push(`${TASK_EMOJI[q.task] ?? '🎯'} **Tipo:** ${TASK_LABEL[q.task] ?? q.task}`);
	if (q.cosponsor) lines.push(`🤝 **Co-sponsor:** ${q.cosponsor}`);
	if (q.orbs > 0) lines.push(`${EMOJI_ORB} **Recompensa:** \`${q.orbs}\` Orbs`);
	if (q.rewardName) lines.push(`🎁 **Prêmio:** ${q.rewardName}`);
	lines.push(`\n**Progresso:**\n${progressBar(q.current, q.total)}`);
	lines.push(
		`\n⏱️ ${q.current}/${q.total} • **${Math.min(
			100,
			Math.round((q.current / (q.total > 0 ? q.total : 1)) * 100)
		)}%**`
	);

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_MAIN} ${q.name}`)
		.setDescription(lines.join('\n'))
		.setColor(color)
		.setFooter({ text: 'Auto Quest • Executando...', iconURL: LOGO_URL })
		.setTimestamp();

	if (q.hero) embed.setImage(`https://cdn.discordapp.com/${q.hero}`);
	if (q.tile) embed.setThumbnail(`https://cdn.discordapp.com/${q.tile}`);

	if (q.startsAt && q.expiresAt) {
		const startTs = Math.floor(new Date(q.startsAt).getTime() / 1000);
		const expiresTs = Math.floor(new Date(q.expiresAt).getTime() / 1000);
		embed.addFields(
			{ name: '🕐 Iniciada', value: `<t:${startTs}:R>`, inline: true },
			{ name: '⏰ Expira', value: `<t:${expiresTs}:R>`, inline: true }
		);
	}

	return embed;
}

function resultEmbed(q: QuestSummary, accountName: string, success: boolean, duration: string): EmbedBuilder {
	const color = success ? COLORS.SUCCESS : COLORS.ERROR;

	const lines: string[] = [];
	lines.push(`${EMOJI_DIRETOR} **Publisher:** ${q.publisher}`);
	if (q.game) lines.push(`${EMOJI_108} **Jogo:** ${q.game}`);
	lines.push(`${TASK_EMOJI[q.task] ?? '🎯'} **Tipo:** ${TASK_LABEL[q.task] ?? q.task}`);
	if (q.orbs > 0) lines.push(`${EMOJI_ORB} **Orbs:** \`${q.orbs}\``);
	if (q.rewardName) lines.push(`🎁 **Prêmio:** ${q.rewardName}`);
	lines.push(`\n${EMOJI_108} **Duração:** \`${duration} min\``);

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(success ? `${EMOJI_CHECK}┃Quest Concluída!` : `${EMOJI_CROSS}┃Quest com Falha`)
		.setDescription(lines.join('\n'))
		.setColor(color)
		.setFooter({ text: 'Auto Quest • Resultado', iconURL: LOGO_URL })
		.setTimestamp();

	if (q.hero) embed.setImage(`https://cdn.discordapp.com/${q.hero}`);
	if (q.tile) embed.setThumbnail(`https://cdn.discordapp.com/${q.tile}`);

	return embed;
}

function statsEmbed(acc: Account): EmbedBuilder {
	const avatarUrl = acc.avatar
		? `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png?size=256`
		: acc.id
		? `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(acc.id) >> 22n) % 6n)}.png`
		: LOGO_URL;

	const status = acc.tokenExpired ? `${EMOJI_CROSS} Token Expirado` : `${EMOJI_CHECK} Ativo`;

	return new EmbedBuilder()
		.setAuthor({ name: `${EMOJI_DIRETOR} Estatísticas`, iconURL: avatarUrl })
		.setTitle(`${EMOJI_MAIN} @${acc.username ?? 'conta'}`)
		.setDescription(
			`${EMOJI_108} **ID:** \`${acc.id ?? 'desconhecido'}\`\n` +
				`${EMOJI_108} **Token:** ${status}\n` +
				`${EMOJI_108} **Última execução:** ${
					acc.lastUpdate ? `<t:${Math.floor(new Date(acc.lastUpdate).getTime() / 1000)}:R>` : 'nunca'
				}\n` +
				`${EMOJI_108} **Última contagem:** \`${acc.lastQuests ?? 0}\` quests\n` +
				`${EMOJI_ORBS} **Último saldo:** \`${acc.lastOrbs ?? 0}\` Orbs`
		)
		.setColor(acc.tokenExpired ? COLORS.ERROR : COLORS.PURPLE)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Stats', iconURL: LOGO_URL })
		.setTimestamp();
}

// ============================================================
// NOTIFICAR TOKEN EXPIRADO NA DM
// ============================================================
async function notifyTokenExpired(discordUserId: string, acc: Account) {
	if (acc.expiredNotified) return;

	try {
		const dmUser = await client.users.fetch(discordUserId);
		if (!dmUser) return;

		await dmUser.send({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: `Auto Quest • ${EMOJI_WARN}`, iconURL: LOGO_URL })
					.setTitle(`${EMOJI_WARN}┃Token Expirado`)
					.setDescription(
						`${EMOJI_108} **Conta:** \`${acc.username ?? 'desconhecida'}\`\n\n` +
							`${EMOJI_CROSS} O token da sua conta **expirou ou foi revogado**.\n\n` +
							`${EMOJI_DIRETOR} **Como resolver:**\n` +
							`${EMOJI_108} Use \`/token\` no servidor com um token novo\n` +
							`${EMOJI_108} Tokens expiram quando você troca a senha ou o Discord revoga por segurança\n\n` +
							`${EMOJI_108} Enquanto isso, o bot **não vai executar quests** nessa conta.`
					)
					.setColor(COLORS.ERROR)
					.setImage(BANNER_URL)
					.setFooter({ text: 'Auto Quest • Reautentique', iconURL: LOGO_URL })
					.setTimestamp(),
			],
		});

		saveAccount(discordUserId, { ...acc, expiredNotified: true });
		logToFile('INFO', `DM de token expirado enviada para ${discordUserId}`);
	} catch (e: any) {
		logToFile('WARN', `Falha ao notificar token expirado: ${e?.message ?? e}`);
	}
}

// ============================================================
// ✅ READY — registra comandos + status
// ============================================================
client.once('ready', async () => {
	console.log(`✅ ${client.user?.tag} online`);
	console.log(`🆔 Bot ID: ${client.user?.id}`);
	logToFile('INFO', `Bot online: ${client.user?.tag}`);

	// ✅ Status personalizado
	try {
		const activityTypeMap: Record<string, number> = {
			PLAYING: ActivityType.Playing,
			WATCHING: ActivityType.Watching,
			LISTENING: ActivityType.Listening,
			COMPETING: ActivityType.Competing,
		};
		const activityType = activityTypeMap[STATUS_TYPE] ?? ActivityType.Watching;

		client.user?.setPresence({
			status: 'online',
			activities: [{ name: STATUS_TEXT, type: activityType }],
		});

		console.log(`✅ Status definido: ${STATUS_TYPE} "${STATUS_TEXT}"`);
	} catch (e: any) {
		console.error('Erro ao setar status:', e?.message ?? e);
	}

	// ✅ Comandos
	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar o token da sua conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover seu token'),
		new SlashCommandBuilder().setName('stats').setDescription('Ver suas estatísticas'),
		new SlashCommandBuilder().setName('perfil').setDescription('Ver perfil da conta logada'),
		new SlashCommandBuilder().setName('ping').setDescription('Status do bot'),
		new SlashCommandBuilder().setName('lock').setDescription('Fechar o canal + criar thread privada'),
		new SlashCommandBuilder().setName('unlock').setDescription('Reabrir o canal + arquivar thread'),
		new SlashCommandBuilder().setName('logs').setDescription('Ver últimas linhas do log'),
	].map((c) => c.toJSON());

	// ✅ UMA chamada só — o PUT já substitui os antigos
	const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
	try {
		console.log(`🔍 Registrando ${commands.length} comandos na guild ${GUILD_ID}...`);

		const data = (await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), {
			body: commands,
		})) as any[];

		console.log(`✅ ${data.length} comandos registrados com sucesso!`);
		console.log(`📋 Comandos: ${data.map((c: any) => `/${c.name}`).join(', ')}`);
		logToFile('INFO', `${data.length} comandos registrados na guild ${GUILD_ID}`);
	} catch (e: any) {
		console.error('❌ Erro registrando comandos:');
		console.error('   message:', e?.message);
		console.error('   code:', e?.code);
		console.error('   status:', e?.status);
		console.error('   rawError:', JSON.stringify(e?.rawError ?? {}).slice(0, 500));
		logToFile('ERROR', `registerCommands: ${e?.message}`);
	}
});

// ============================================================
// VERIFY ACCOUNT
// ============================================================
async function verifyAccount(token: string): Promise<ProfileInfo | null> {
	return new Promise((resolve) => {
		let profileJson: string | null = null;
		let tokenExpired = false;
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
					const evtMatch = line.match(/__EVT__(\{.+?\})__EVT__/);
					if (evtMatch) {
						try {
							const evt = JSON.parse(evtMatch[1]);
							if (evt.event === 'error' && evt.code === 'TOKEN_EXPIRED') {
								tokenExpired = true;
							}
						} catch {}
					}

					const m = line.match(/__PROFILE_JSON_START__(.+?)__PROFILE_JSON_END__/);
					if (m) profileJson = m[1];
				},
				() => {
					if (!profileJson) return finish(null);
					try {
						const parsed = JSON.parse(profileJson);
						if (tokenExpired) (parsed as any).expired = true;
						finish(parsed);
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
			try {
				child?.kill('SIGTERM');
			} catch {}
			setTimeout(() => {
				try {
					child?.kill('SIGKILL');
				} catch {}
			}, 5000);
			if (profileJson) {
				try {
					finish(JSON.parse(profileJson));
				} catch {
					finish(null);
				}
			} else {
				finish(null);
			}
		}, 180 * 1000);
	});
}

// ============================================================
// RUN SINGLE QUEST
// ============================================================
async function runSingleQuest(
	token: string,
	quest: QuestSummary,
	accountName: string,
	dmId: string,
	executionId: string,
	interaction: any,
	baseMessage: string,
) {
	if (finishedExecutions.has(executionId)) {
		logToFile('WARN', `Execução ${executionId} já finalizada`);
		return;
	}

	const startTime = Date.now();
	let tokenExpiredDetected = false;

	try {
		await interaction.editReply({
			content: `${EMOJI_QUEUE} **${baseMessage}**`,
			embeds: [liveQuestEmbed(quest, accountName)],
			components: [],
		});
	} catch {}

	await new Promise<void>((resolve) => {
		const child = runBot(
			token,
			'quest_single',
			async (line: string) => {
				try {
					const evtMatch = line.match(/__EVT__(\{.+?\})__EVT__/);
					if (evtMatch) {
						try {
							const evt = JSON.parse(evtMatch[1]);
							if (evt.event === 'error' && evt.code === 'TOKEN_EXPIRED') {
								tokenExpiredDetected = true;
								logToFile('WARN', `Token expirado detectado (${executionId})`);
							}
						} catch {}
					}

					const progressMatch = line.match(/__PROGRESS_UPDATE__(\{.+?\})__PROGRESS_UPDATE__/);
					if (progressMatch) {
						try {
							const data = JSON.parse(progressMatch[1]);
							quest.current = data.current;
							quest.total = data.total;

							await interaction.editReply({
								content: `${EMOJI_QUEUE} **${baseMessage}**`,
								embeds: [liveQuestEmbed(quest, accountName)],
								components: [],
							});
						} catch {}
					}
				} catch {}
			},
			async (code: number) => {
				if (finishedExecutions.has(executionId)) {
					resolve();
					return;
				}
				finishedExecutions.add(executionId);

				const duration = ((Date.now() - startTime) / 60000).toFixed(1);
				const success = code === 0 && !tokenExpiredDetected;

				if (tokenExpiredDetected) {
					try {
						await interaction.editReply({
							content: `${EMOJI_WARN} **${baseMessage}**`,
							embeds: [
								new EmbedBuilder()
									.setAuthor({ name: `Auto Quest • ${EMOJI_WARN}`, iconURL: LOGO_URL })
									.setTitle(`${EMOJI_WARN}┃Token Expirado`)
									.setDescription(
										`${EMOJI_108} O token da conta **expirou ou foi resetado**.\n` +
											`${EMOJI_108} Use \`/token\` novamente para continuar.`
									)
									.setColor(COLORS.ERROR)
									.setImage(BANNER_URL)
									.setTimestamp(),
							],
							components: [],
						});
					} catch {}
				} else {
					try {
						await interaction.editReply({
							content: `${success ? EMOJI_CHECK : EMOJI_CROSS} **${baseMessage}**`,
							embeds: [resultEmbed(quest, accountName, success, duration)],
							components: [],
						});
					} catch {}
				}

				try {
					const dmUser = await client.users.fetch(dmId);
					if (dmUser) {
						if (tokenExpiredDetected) {
							await dmUser.send({
								embeds: [
									new EmbedBuilder()
										.setAuthor({ name: `Auto Quest • ${EMOJI_WARN}`, iconURL: LOGO_URL })
										.setTitle(`${EMOJI_WARN}┃Token Expirado`)
										.setDescription(
											`${EMOJI_108} **Conta:** \`${accountName}\`\n\n` +
												`${EMOJI_CROSS} O token foi **resetado ou expirou**.\n` +
												`${EMOJI_CROSS} A quest **não foi concluída**.\n\n` +
												`${EMOJI_108} Use \`/token\` novamente com o token novo.`
										)
										.setColor(COLORS.ERROR)
										.setImage(BANNER_URL)
										.setFooter({ text: 'Auto Quest • Reautentique', iconURL: LOGO_URL })
										.setTimestamp(),
								],
							});
						} else if (success) {
							await dmUser.send({
								embeds: [
									new EmbedBuilder()
										.setAuthor({ name: `Auto Quest • ${EMOJI_DM}`, iconURL: LOGO_URL })
										.setTitle(`${EMOJI_CHECK}┃Missão Concluída!`)
										.setDescription(
											`${EMOJI_108} **Quest:** \`${quest.name}\`\n` +
												`${EMOJI_108} **Jogo:** \`${quest.game}\`\n` +
												`${EMOJI_ORB} **Orbs ganhos:** \`${quest.orbs}\`\n` +
												`${EMOJI_108} **Duração:** \`${duration} min\``
										)
										.setColor(COLORS.SUCCESS)
										.setThumbnail(quest.tile ? `https://cdn.discordapp.com/${quest.tile}` : undefined)
										.setImage(BANNER_URL)
										.setFooter({ text: 'Auto Quest • Notificação', iconURL: LOGO_URL })
										.setTimestamp(),
								],
							});
						} else {
							await dmUser.send({
								embeds: [
									new EmbedBuilder()
										.setAuthor({ name: `Auto Quest • ${EMOJI_WARN}`, iconURL: LOGO_URL })
										.setTitle(`${EMOJI_CROSS}┃Quest Falhou`)
										.setDescription(
											`${EMOJI_108} **Quest:** \`${quest.name}\`\n` +
												`${EMOJI_108} **Jogo:** \`${quest.game}\``
										)
										.setColor(COLORS.ERROR)
										.setFooter({ text: 'Auto Quest • Notificação', iconURL: LOGO_URL })
										.setTimestamp(),
								],
							});
						}
					}
				} catch (e: any) {
					logToFile('WARN', `DM falhou: ${e?.message ?? e}`);
				}

				if (tokenExpiredDetected) {
					try {
						const acc = getAccount(dmId);
						if (acc) {
							saveAccount(dmId, { ...acc, tokenExpired: true, expiredNotified: true });
						}
					} catch {}
				}

				logToFile(
					'INFO',
					`Quest finalizada: ${quest.name} OK=${success} expired=${tokenExpiredDetected} (${duration}min)`
				);
				resolve();
			},
			{ QUEST_ID: quest.id }
		);

		activeChildren.set(dmId, child);
	});
}

// ============================================================
// HANDLE LOGIN
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

async function handleLogin(interaction: any, user: any, token: string) {
	token = token.trim().replace(/^Bot\s+/i, '').replace(/\s+/g, '');

	if (!isValidDiscordToken(token)) {
		await interaction.reply({ embeds: [tokenWrongEmbed('Formato de token inválido.')], flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await interaction.reply({ embeds: [verifyingTokenEmbed()], flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('reply falhou:', e);
		return;
	}

	const existing = getAccount(user.id);
	const info = await verifyAccount(token);

	if (info && !(info as any).expired) {
		saveAccount(user.id, {
			...(existing ?? {}),
			token,
			username: info.username,
			id: info.id,
			avatar: info.avatar ?? undefined,
			lastQuests: info.quests,
			lastOrbs: info.orbs ?? 0,
			lastUpdate: new Date().toISOString(),
			questsList: info.questsList ?? [],
			tokenExpired: false,
			expiredNotified: false,
		});

		try {
			await interaction.editReply({ embeds: [loginSuccessEmbed(info)] });
		} catch (e) {
			console.error('editReply sucesso falhou:', e);
		}
		logToFile('INFO', `Login OK: ${user.tag} -> @${info.username}`);
		return;
	}

	if (existing?.username && existing?.id) {
		saveAccount(user.id, { ...existing, tokenExpired: true });
		await notifyTokenExpired(user.id, { ...existing, tokenExpired: true });
		try {
			await interaction.editReply({ embeds: [tokenExpiredEmbed()] });
		} catch {}
		return;
	}

	try {
		await interaction.editReply({ embeds: [tokenWrongEmbed()] });
	} catch {}
}

// ============================================================
// HANDLE AUTO-QUEST MENU
// ============================================================
async function handleAutoQuestMenu(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}

	if (acc.tokenExpired) {
		await interaction.reply({ embeds: [tokenExpiredEmbed()], flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('deferReply falhou:', e);
		return;
	}

	const info = await verifyAccount(acc.token);

	if (!info || (info as any).expired) {
		saveAccount(user.id, { ...acc, tokenExpired: true });
		await notifyTokenExpired(user.id, { ...acc, tokenExpired: true });
		await interaction.editReply({ embeds: [tokenExpiredEmbed()] });
		return;
	}

	if ((info.questsList?.length ?? 0) === 0) {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: `Auto Quest • @${acc.username ?? 'conta'}`, iconURL: LOGO_URL })
					.setTitle(`${EMOJI_MAIN}┃Nenhuma Missão Disponível`)
					.setDescription(
						'**Não há missões disponíveis no momento.**\n\n' +
							`${EMOJI_108} Volte mais tarde ou verifique se sua conta já completou todas as quests ativas.`
					)
					.setColor(COLORS.BLURPLE)
					.setImage(BANNER_URL)
					.setTimestamp(),
			],
		});
		return;
	}

	saveAccount(user.id, {
		...acc,
		username: info.username,
		id: info.id,
		avatar: info.avatar ?? undefined,
		lastQuests: info.quests,
		lastOrbs: info.orbs ?? 0,
		lastUpdate: new Date().toISOString(),
		questsList: info.questsList ?? [],
		tokenExpired: false,
	});

	await interaction.editReply({
		embeds: [questSelectEmbed(info)],
		components: [...questSelectMenu(info), ...questSelectButtons(true)],
	});
}

// ============================================================
// EXECUTE QUEST (individual)
// ============================================================
async function handleExecuteQuest(interaction: any, user: any, questId: string) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}

	const quest = (acc.questsList ?? []).find((q) => q.id === questId);
	if (!quest) {
		await interaction.reply({ content: '❌ Quest não encontrada.', flags: MessageFlags.Ephemeral });
		return;
	}

	if (runningUsers.has(user.id)) {
		await interaction.reply({ content: '⏳ Já em execução.', flags: MessageFlags.Ephemeral });
		return;
	}

	const last = lastRun.get(user.id) ?? 0;
	if (Date.now() - last < COOLDOWN_MS) {
		const remain = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
		await interaction.reply({ content: `⏳ Aguarde **${Math.ceil(remain / 60)} min**.`, flags: MessageFlags.Ephemeral });
		return;
	}
	lastRun.set(user.id, Date.now());
	runningUsers.add(user.id);

	await interaction.update({
		content: `${EMOJI_QUEUE} **Iniciando quest...**`,
		embeds: [liveQuestEmbed(quest, acc.username ?? 'conta')],
		components: [],
	});

	const targetDmId = acc.id ?? user.id;
	const executionId = `${user.id}-${quest.id}-${Date.now()}`;

	try {
		await runSingleQuest(acc.token, quest, acc.username ?? 'conta', targetDmId, executionId, interaction, `Quest Única`);
	} finally {
		runningUsers.delete(user.id);
	}
}

// ============================================================
// EXECUTE ALL
// ============================================================
async function handleExecuteAll(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc || !acc.questsList?.length) {
		await interaction.reply({ content: '❌ Nenhuma quest para executar.', flags: MessageFlags.Ephemeral });
		return;
	}

	if (runningUsers.has(user.id)) {
		await interaction.reply({ content: '⏳ Já em execução.', flags: MessageFlags.Ephemeral });
		return;
	}

	const last = lastRun.get(user.id) ?? 0;
	if (Date.now() - last < COOLDOWN_MS) {
		const remain = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
		await interaction.reply({ content: `⏳ Aguarde **${Math.ceil(remain / 60)} min**.`, flags: MessageFlags.Ephemeral });
		return;
	}
	lastRun.set(user.id, Date.now());
	runningUsers.add(user.id);

	const total = acc.questsList.length;
	const targetDmId = acc.id ?? user.id;

	await interaction.update({
		content:
			`${EMOJI_BATCH} **Fazendo Todas as Quests**\n` +
			`${EMOJI_108} **Total:** \`${total}\` quest(s)\n` +
			`${EMOJI_108} **Delay:** \`3 min\` entre cada\n` +
			`${EMOJI_108} Você vai receber **DM** a cada conclusão.`,
		embeds: [liveQuestEmbed(acc.questsList[0], acc.username ?? 'conta')],
		components: [],
	});

	(async () => {
		try {
			for (let i = 0; i < acc.questsList!.length; i++) {
				const quest = acc.questsList![i];
				const executionId = `${user.id}-${quest.id}-${Date.now()}`;

				logToFile('INFO', `[batch ${i + 1}/${total}] ${quest.name}`);

				await runSingleQuest(
					acc.token,
					quest,
					acc.username ?? 'conta',
					targetDmId,
					executionId,
					interaction,
					`[${i + 1}/${total}] Batch`
				);

				if (i < acc.questsList!.length - 1) {
					try {
						await interaction.editReply({
							content:
								`${EMOJI_QUEUE} **Aguardando 3 min...**\n` +
								`${EMOJI_108} Próxima quest: \`${acc.questsList![i + 1].name}\`\n` +
								`${EMOJI_108} Progresso: ${i + 1}/${total}`,
							embeds: [liveQuestEmbed(acc.questsList![i + 1], acc.username ?? 'conta')],
							components: [],
						});
					} catch {}
					await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
				}
			}

			try {
				await interaction.editReply({
					content: `${EMOJI_CHECK} **Batch finalizado!** ${total}/${total} quest(s) processadas.`,
					embeds: [],
					components: [],
				});
			} catch {}

			logToFile('INFO', `[batch] finalizado para ${user.tag}`);
		} catch (e: any) {
			logToFile('ERROR', `[batch] erro: ${e?.message ?? e}`);
		} finally {
			runningUsers.delete(user.id);
		}
	})();
}

// ============================================================
// /LOCK e /UNLOCK
// ============================================================
async function handleLock(interaction: any) {
	const channel = interaction.channel;
	if (!channel || channel.id !== ALLOWED_CHANNEL) {
		await interaction.reply({ content: '❌ Use apenas no canal permitido.', flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });

		const thread = await channel.threads.create({
			name: `🔒 Auto-Quest • ${interaction.user.username}`,
			type: ChannelType.PrivateThread,
			reason: `Lock por ${interaction.user.tag}`,
		});

		await thread.members.add(interaction.user.id);

		await interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Auto Quest • Lock', iconURL: LOGO_URL })
					.setTitle(`${EMOJI_LOCK}┃Canal Fechado`)
					.setDescription(
						`${EMOJI_108} O canal foi fechado para \`@everyone\`.\n` +
							`${EMOJI_108} Thread criada: <#${thread.id}>\n\n` +
							`${EMOJI_108} Use \`/unlock\` para reabrir.`
					)
					.setColor(COLORS.SUCCESS)
					.setTimestamp(),
			],
			flags: MessageFlags.Ephemeral,
		});
	} catch (e: any) {
		await interaction.reply({ content: `❌ Erro ao lockar: ${e?.message}`, flags: MessageFlags.Ephemeral });
	}
}

async function handleUnlock(interaction: any) {
	const channel = interaction.channel;
	if (!channel || channel.id !== ALLOWED_CHANNEL) {
		await interaction.reply({ content: '❌ Use apenas no canal permitido.', flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });

		await interaction.reply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Auto Quest • Unlock', iconURL: LOGO_URL })
					.setTitle(`${EMOJI_UNLOCK}┃Canal Reaberto`)
					.setDescription(`${EMOJI_108} O canal foi reaberto para \`@everyone\`.`)
					.setColor(COLORS.SUCCESS)
					.setTimestamp(),
			],
			flags: MessageFlags.Ephemeral,
		});
	} catch (e: any) {
		await interaction.reply({ content: `❌ Erro ao unlockar: ${e?.message}`, flags: MessageFlags.Ephemeral });
	}
}

// ============================================================
// MODAL
// ============================================================
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
// INTERACTIONS
// ============================================================
client.on('interactionCreate', async (interaction: Interaction) => {
	try {
		if (interaction.user.id !== OWNER_ID) {
			if (interaction.isRepliable()) {
				await interaction.reply({ content: '❌ Sem permissão para usar este bot.', flags: MessageFlags.Ephemeral });
			}
			return;
		}

		const channel = interaction.channel;
		const isAllowedChannel =
			interaction.channelId === ALLOWED_CHANNEL ||
			(channel && 'isThread' in channel && (channel as any).isThread());

		if (!isAllowedChannel && interaction.isRepliable()) {
			await interaction.reply({
				content: `❌ Use apenas no canal <#${ALLOWED_CHANNEL}>.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (interaction.isChatInputCommand()) {
			const { commandName, user } = interaction;

			if (commandName === 'painel') {
				await interaction.reply({ embeds: [mainPanelEmbed()], components: mainPanelButtons() });
				return;
			}

			if (commandName === 'token') {
				const tk = interaction.options.getString('token', true).trim();
				await handleLogin(interaction, user, tk);
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
				if (info && !(info as any).expired) {
					saveAccount(user.id, {
						...acc,
						username: info.username,
						id: info.id,
						avatar: info.avatar ?? undefined,
						lastQuests: info.quests,
						lastOrbs: info.orbs ?? 0,
						lastUpdate: new Date().toISOString(),
						questsList: info.questsList ?? [],
						tokenExpired: false,
						expiredNotified: false,
					});
					await interaction.editReply({ embeds: [loginSuccessEmbed(info)] });
				} else {
					saveAccount(user.id, { ...acc, tokenExpired: true });
					await notifyTokenExpired(user.id, { ...acc, tokenExpired: true });
					await interaction.editReply({ embeds: [tokenExpiredEmbed()] });
				}
				return;
			}

			if (commandName === 'lock') {
				await handleLock(interaction);
				return;
			}
			if (commandName === 'unlock') {
				await handleUnlock(interaction);
				return;
			}

			if (commandName === 'ping') {
				await interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: 'Status • Auto Quest', iconURL: LOGO_URL })
							.setTitle(`${EMOJI_MAIN} Pong!`)
							.addFields(
								{ name: '📡 WebSocket', value: `${client.ws.ping}ms`, inline: true },
								{ name: '⏱️ Uptime', value: `${Math.floor(process.uptime() / 60)}m`, inline: true },
								{ name: '👥 Ativos', value: `${runningUsers.size}`, inline: true }
							)
							.setColor(COLORS.SUCCESS)
							.setTimestamp(),
					],
					flags: MessageFlags.Ephemeral,
				});
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
				await handleAutoQuestMenu(interaction, user);
				return;
			}
			if (customId === 'back_to_select') {
				await handleAutoQuestMenu(interaction, user);
				return;
			}
			if (customId === 'run_all_quests') {
				await handleExecuteAll(interaction, user);
				return;
			}
			if (customId === 'orbs') {
				await handleAutoQuestMenu(interaction, user);
				return;
			}

			if (customId === 'back_to_panel') {
				await interaction.update({ embeds: [mainPanelEmbed()], components: mainPanelButtons() });
				return;
			}

			if (customId.startsWith('cancel_quest_') || customId.startsWith('cancel_queue_')) {
				const child = activeChildren.get(user.id);
				if (child) {
					try {
						child.kill('SIGTERM');
					} catch {}
					setTimeout(() => {
						try {
							child.kill('SIGKILL');
						} catch {}
					}, 3000);
					activeChildren.delete(user.id);
					runningUsers.delete(user.id);
					await interaction.reply({ content: '🛑 Cancelado.', flags: MessageFlags.Ephemeral });
				} else {
					await interaction.reply({ content: '❌ Nada em execução.', flags: MessageFlags.Ephemeral });
				}
				return;
			}

			if (customId.startsWith('execute_quest_')) {
				const questId = customId.replace('execute_quest_', '');
				await handleExecuteQuest(interaction, user, questId);
				return;
			}
		}

		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === 'select_quest') {
				const questId = interaction.values[0];
				const acc = getAccount(interaction.user.id);
				if (!acc) return;
				const quest = (acc.questsList ?? []).find((q) => q.id === questId);
				if (!quest) {
					await interaction.reply({ content: '❌ Quest não encontrada.', flags: MessageFlags.Ephemeral });
					return;
				}
				await interaction.update({
					embeds: [questDetailEmbed(quest, acc.username ?? 'conta')],
					components: questDetailButtons(questId),
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
