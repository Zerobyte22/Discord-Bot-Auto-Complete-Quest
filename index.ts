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
	TextChannel,
	DMChannel,
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
const LOG_FILE = path.join(__dirname, 'auto-quest.log');
const LOG_MAX_BYTES = 5 * 1024 * 1024;

// ============================================================
// EMOJIS — todos Unicode (funcionam em qualquer guild)
// ============================================================
const EMOJI_QUEST = '🔍';
const EMOJI_USER = '👤';
const EMOJI_ORBS = '🔮';
const EMOJI_MAIN = '🚀';
const EMOJI_DIRETOR = '📋';
const EMOJI_108 = '▫️';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_ORB = '🔮';
const EMOJI_GHOST = '👻'; // ✅ fantasma pra evitar emoji quebrado
const EMOJI_VIDEO = '🎬';
const EMOJI_GAME = '🎮';

// Botões — emojis animados (com fallback Unicode)
const EMOJI_LOGIN_STAR = '🌟';
const EMOJI_ROCKET_ANIM = '🚀';
const EMOJI_LIGHTNING_ANIM = '⚡';

const ROCKET_ID = '1555258534441259148';
const LIGHTNING_ID = '1555258800301154374';

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
			try { await msg.delete(); } catch {}
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
type Mode =
	| 'sequential_no_delay'
	| 'sequential_delay'
	| 'all_parallel'
	| 'all_delay'
	| 'profile'
	| 'quest_single';

const activeChildren = new Map<string, any>();
const lastRun = new Map<string, number>();
const COOLDOWN_MS = 30 * 1000;

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
	VIDEO: 0xeb459e,
	GAME: 0x3498db,
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
			new ButtonBuilder().setCustomId('login').setLabel('Login').setEmoji(EMOJI_LOGIN_STAR).setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId('autoquest').setLabel('Auto-Quest').setEmoji(EMOJI_ROCKET_ANIM).setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId('orbs').setLabel('Orbs').setEmoji(EMOJI_ORBS).setStyle(ButtonStyle.Secondary)
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

function tokenWrongEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Erro de Token', iconURL: LOGO_URL })
		.setTitle(`${EMOJI_GHOST}┃Token Incorreto`)
		.setDescription(
			'**Você só pode adicionar o token da sua própria conta!**\n\n' +
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
				`\n\n${EMOJI_108} Use o menu abaixo pra escolher qual executar.`
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
		const emoji = TASK_EMOJI[q.task] ?? '🎯';
		const tipo = isVideoTask(q.task) ? 'Vídeo' : 'Jogo';
		const orbs = q.orbs > 0 ? `${q.orbs} Orbs` : 'sem Orbs';

		const option = new StringSelectMenuOptionBuilder()
			.setLabel(q.name.slice(0, 95))
			.setDescription(`${tipo} • ${orbs} • ${q.current}/${q.total}`.slice(0, 95))
			.setValue(q.id);

		menu.addOptions(option);
	}

	return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
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
	lines.push(`${EMOJI_108} **Tipo:** ${TASK_LABEL[q.task] ?? q.task}`);
	if (q.orbs > 0) lines.push(`${EMOJI_ORB} **Recompensa:** \`${q.orbs}\` Orbs`);
	lines.push(`\n**Progresso:**\n${progressBar(q.current, q.total)}`);
	lines.push(`\n⏱️ ${q.current}/${q.total}`);

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_MAIN} ${q.name}`)
		.setDescription(lines.join('\n'))
		.setColor(color)
		.setFooter({ text: 'Auto Quest • Executando...', iconURL: LOGO_URL })
		.setTimestamp();

	if (q.hero) embed.setImage(`https://cdn.discordapp.com/${q.hero}`);
	if (q.tile) embed.setThumbnail(`https://cdn.discordapp.com/${q.tile}`);

	return embed;
}

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
// READY
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
// VERIFY ACCOUNT
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
					try { finish(JSON.parse(profileJson)); } catch { finish(null); }
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

// ============================================================
// TOKEN VALIDATION — minimalista, aceita QUALQUER token
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

	console.log(`🔍 Token recebido: len=${token.length} parts=${token.split('.').length}`);

	if (!isValidDiscordToken(token)) {
		await interaction.reply({ embeds: [tokenWrongEmbed()], flags: MessageFlags.Ephemeral });
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

	if (info) {
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
		const cachedInfo: ProfileInfo = {
			id: existing.id,
			username: existing.username,
			global_name: null,
			avatar: existing.avatar ?? null,
			quests: existing.lastQuests ?? 0,
			orbs: existing.lastOrbs ?? 0,
			questsList: existing.questsList ?? [],
		};
		try {
			await interaction.editReply({ embeds: [loginSuccessEmbed(cachedInfo)] });
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

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('deferReply falhou:', e);
		return;
	}

	const info = await verifyAccount(acc.token);

	if (!info || (info.questsList?.length ?? 0) === 0) {
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
	});

	await interaction.editReply({
		embeds: [questSelectEmbed(info)],
		components: questSelectMenu(info),
	});
}

// ============================================================
// EXECUTE QUEST
// ============================================================
async function handleExecuteQuest(interaction: any, user: any, questId: string) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}

	if (runningUsers.has(user.id)) {
		await interaction.reply({ content: '⏳ Já em execução.', flags: MessageFlags.Ephemeral });
		return;
	}

	const quest = (acc.questsList ?? []).find((q) => q.id === questId);
	if (!quest) {
		await interaction.reply({ content: '❌ Quest não encontrada. Atualize o painel.', flags: MessageFlags.Ephemeral });
		return;
	}

	const last = lastRun.get(user.id) ?? 0;
	if (Date.now() - last < COOLDOWN_MS) {
		const remain = Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000);
		await interaction.reply({ content: `⏳ Aguarde **${remain}s**.`, flags: MessageFlags.Ephemeral });
		return;
	}
	lastRun.set(user.id, Date.now());
	runningUsers.add(user.id);

	const channel = interaction.channel;
	if (!channel || !('send' in channel)) {
		runningUsers.delete(user.id);
		await interaction.reply({ content: '❌ Canal inválido.', flags: MessageFlags.Ephemeral });
		return;
	}

	await interaction.deferUpdate();

	const accountName = acc.username ?? 'conta';
	const startTime = Date.now();

	const liveMsg = await channel.send({ embeds: [liveQuestEmbed(quest, accountName)] });

	const child = runBot(
		acc.token,
		'quest_single',
		async (line) => {
			try {
				const progressMatch = line.match(/__PROGRESS_UPDATE__(\{.+?\})__PROGRESS_UPDATE__/);
				if (progressMatch) {
					try {
						const data = JSON.parse(progressMatch[1]);
						quest.current = data.current;
						quest.total = data.total;
						await liveMsg.edit({ embeds: [liveQuestEmbed(quest, accountName)] });
					} catch {}
				}
			} catch {}
		},
		async (code) => {
			runningUsers.delete(user.id);
			activeChildren.delete(user.id);

			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			try {
				await liveMsg.edit({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
							.setTitle(success ? `${EMOJI_MAIN}┃Quest Concluída!` : `${EMOJI_MAIN}┃Quest com Falha`)
							.setDescription(
								`${EMOJI_108} **Quest:** \`${quest.name}\`\n` +
									`${EMOJI_108} **Tipo:** \`${TASK_LABEL[quest.task] ?? quest.task}\`\n` +
									`${EMOJI_ORB} **Orbs:** \`${quest.orbs}\`\n` +
									`${EMOJI_108} **Duração:** \`${duration} min\``
							)
							.setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
							.setTimestamp(),
					],
				});
			} catch {}

			try {
				await channel.send({
					content: `<@${user.id}> — Quer rodar outra?`,
					components: [
						new ActionRowBuilder<ButtonBuilder>().addComponents(
							new ButtonBuilder()
								.setCustomId('autoquest')
								.setLabel('Voltar ao Seletor')
								.setEmoji('🚀')
								.setStyle(ButtonStyle.Primary)
						),
					],
				});
			} catch {}

			logToFile('INFO', `Quest single finalizada: ${user.tag} OK=${success}`);
		},
		{ QUEST_ID: questId }
	);

	activeChildren.set(user.id, child);

	setTimeout(() => {
		try { child.kill('SIGTERM'); } catch {}
		setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
	}, 2 * 60 * 60 * 1000);
}

// ============================================================
// ORBS
// ============================================================
async function handleOrbs(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch { return; }

	const info = await verifyAccount(acc.token);
	if (!info) {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle(`${EMOJI_GHOST}┃Falha ao buscar Orbs`)
					.setDescription('Não consegui consultar a API do Discord. Tente novamente.')
					.setColor(COLORS.ERROR)
					.setTimestamp(),
			],
		});
		return;
	}

	const breakdown = (info.questsList ?? [])
		.filter((q) => q.orbs > 0)
		.map((q) => ({ name: q.name, orbs: q.orbs }));

	const total = breakdown.reduce((a, b) => a + b.orbs, 0);
	saveAccount(user.id, { ...acc, lastOrbs: total });

	await interaction.editReply({ embeds: [orbsEmbed(acc.username ?? 'conta', total, breakdown)] });
}

// ============================================================
// INTERACTIONS
// ============================================================
client.on('interactionCreate', async (interaction: Interaction) => {
	try {
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
					saveAccount(user.id, {
						...acc,
						username: info.username,
						id: info.id,
						avatar: info.avatar ?? undefined,
						lastQuests: info.quests,
						lastOrbs: info.orbs ?? 0,
						lastUpdate: new Date().toISOString(),
						questsList: info.questsList ?? [],
					});
					await interaction.editReply({ embeds: [loginSuccessEmbed(info)] });
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
				await handleAutoQuestMenu(interaction, user);
				return;
			}

			if (customId === 'orbs') {
				await handleOrbs(interaction, user);
				return;
			}

			if (customId === 'back_to_select') {
				await handleAutoQuestMenu(interaction, user);
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

			if (customId.startsWith('execute_quest_')) {
				const questId = customId.replace('execute_quest_', '');
				await handleExecuteQuest(interaction, user, questId);
				return;
			}
		}

		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === 'select_quest') {
				const questId = interaction.values[0];
				const user = interaction.user;
				const acc = getAccount(user.id);
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

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));
