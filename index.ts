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
} from 'discord.js';
import fs from 'fs';
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

// ============================================================
// EMOJIS
// ============================================================
const EMOJI_ROCKET = '🚀';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_ORB = '🔮';

const ROCKET_ID = '1555258534441259148';
const ROCKET_NAME = '270171rocket';
const LIGHTNING_ID = '1555258800301154374';
const LIGHTNING_NAME = '653548lightning';
const QUEST_ICON_ID = '1516711962061443114';
const QUEST_ICON_NAME = 'Icon_Quests';

const ROCKET_BTN = { id: ROCKET_ID, name: ROCKET_NAME, animated: true };
const LIGHTNING_BTN = { id: LIGHTNING_ID, name: LIGHTNING_NAME, animated: true };

const BANNER_URL =
	'https://cdn.discordapp.com/attachments/1552448890656137297/1555470801904345108/1790923506283.jpg?backend=b2&ex=6ac0a492&is=6abf5312&hm=32123b4e477083c1ae208e41538c64230f08ac1d73a9eab19572c16650bac471&';
const LOGO_URL = process.env.LOGO_URL || BANNER_URL;

// ============================================================
// LOG
// ============================================================
function logToFile(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
	const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
	try {
		fs.appendFileSync(LOG_FILE, line);
	} catch {
		/* ignore */
	}
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
			} catch {
				/* ignore */
			}
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
				if (typeof val === 'string') {
					result[userId] = { token: val };
				} else if (Array.isArray(val) && val[0]) {
					result[userId] = val[0] as Account;
				} else if (val && typeof val === 'object') {
					result[userId] = val as Account;
				}
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
// QUEST CACHE
// ============================================================
interface QuestCacheEntry {
	data: any[];
	at: number;
}
const questCache = new Map<string, QuestCacheEntry>();

function getCachedQuests(userId: string): any[] | null {
	const cached = questCache.get(userId);
	if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;
	return null;
}

function setCachedQuests(userId: string, data: any[]) {
	questCache.set(userId, { data, at: Date.now() });
}

function clearQuestCache(userId: string) {
	questCache.delete(userId);
}

// ============================================================
// CHILD PROCESS
// ============================================================
type Mode = 'sequential_no_delay' | 'sequential_delay' | 'all_parallel' | 'all_delay' | 'profile';

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

	child.on('close', (code) => onDone(code ?? 0, fullOutput, errorOutput));
	child.on('error', (err) => onDone(1, fullOutput, err.message));

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
// EMBEDS
// ============================================================
function mainPanelEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
		.setTitle(`<:${QUEST_ICON_NAME}:${QUEST_ICON_ID}> Auto Quest`)
		.setDescription(
			'`[+] Sobre o Sistema:`\n' +
				'> Apresentamos o sistema definitivo para automação no Discord. Chega de perder tempo com tarefas repetitivas!\n' +
				'> ```diff\n' +
				'> - Trabalho manual e dor de cabeça.\n' +
				'> + Automação simples, rápida e 100% segura!\n' +
				'> ```\n\n' +
				'`[+] Missões de Vídeos:`\n' +
				'> Conclua missões de vídeo sem precisar assistir! Nosso sistema automatiza tudo em segundo plano, de forma muito mais eficiente.\n' +
				'> ```diff\n' +
				'> - Assistir ao vídeo inteiro.\n' +
				'> + Processo 6x mais rápido e totalmente automático!\n' +
				'> ```\n\n' +
				'`[+] Missões de Jogos:`\n' +
				'> Complete missões de jogos sem precisar baixar, comprar ou sequer jogar. Nossa tecnologia simula sua presença no game de forma inteligente.\n' +
				'> ```diff\n' +
				'> - Baixar e instalar jogos pesados.\n' +
				'> + Simulação instantânea, missão concluída!\n' +
				'> ```'
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
				.setEmoji(ROCKET_BTN)
				.setStyle(ButtonStyle.Secondary),
			new ButtonBuilder()
				.setCustomId('autoquest')
				.setLabel('Auto-Quest')
				.setEmoji(LIGHTNING_BTN)
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('profile')
				.setLabel('Perfil')
				.setEmoji('👤')
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
// PROGRESS BAR
// ============================================================
function progressBar(current: number, total: number, length = 15): string {
	const safeTotal = total > 0 ? total : 1;
	const percent = Math.min(100, Math.round((current / safeTotal) * 100));
	const filled = Math.round((percent / 100) * length);
	const empty = length - filled;
	return `\`[${'█'.repeat(filled)}${'░'.repeat(empty)}]\` **${percent}%**`;
}

// ============================================================
// LIVE QUEST EMBED
// ============================================================
interface LiveQuest {
	id: string;
	name: string;
	game: string;
	publisher: string;
	hero: string | null;
	tile: string | null;
	logo: string | null;
	primaryColor: string | null;
	secondaryColor: string | null;
	current: number;
	total: number;
	task: string;
	orbs: number;
	rewardName: string | null;
	rewardAsset: string | null;
	startsAt: string | null;
	expiresAt: string | null;
	cosponsor: string | null;
}

function liveProgressEmbed(quest: LiveQuest, accountName: string): EmbedBuilder {
	const safeTotal = quest.total > 0 ? quest.total : 1;
	const percent = Math.min(100, Math.round((quest.current / safeTotal) * 100));

	const color = quest.primaryColor
		? parseInt(quest.primaryColor.replace('#', ''), 16)
		: COLORS.PURPLE;

	const lines: string[] = [];
	lines.push(`🏢 **Publisher:** ${quest.publisher}`);
	lines.push(`🎯 **Tipo:** ${TASK_NAMES[quest.task] ?? quest.task}`);
	if (quest.cosponsor) lines.push(`🤝 **Co-sponsor:** ${quest.cosponsor}`);
	if (quest.orbs > 0) lines.push(`${EMOJI_ORB} **Recompensa:** \`${quest.orbs}\` Orbs`);
	if (quest.rewardName) lines.push(`🎁 **Prêmio:** ${quest.rewardName}`);
	lines.push(`\n**Progresso:**\n${progressBar(quest.current, quest.total)}`);
	lines.push(`\n⏱️ ${quest.current}/${quest.total} • **${percent}%**`);

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_ROCKET} ${quest.name}`)
		.setDescription(lines.join('\n'))
		.setColor(color)
		.setFooter({ text: 'Auto Quest • Executando...', iconURL: LOGO_URL })
		.setTimestamp();

	if (quest.hero) embed.setImage(`https://cdn.discordapp.com/${quest.hero}`);
	if (quest.tile) embed.setThumbnail(`https://cdn.discordapp.com/${quest.tile}`);

	if (quest.startsAt && quest.expiresAt) {
		const startTs = Math.floor(new Date(quest.startsAt).getTime() / 1000);
		const expiresTs = Math.floor(new Date(quest.expiresAt).getTime() / 1000);
		embed.addFields(
			{ name: '🕐 Iniciada', value: `<t:${startTs}:R>`, inline: true },
			{ name: '⏰ Expira', value: `<t:${expiresTs}:R>`, inline: true }
		);
	}

	return embed;
}

// ============================================================
// PROFILE EMBED
// ============================================================
function profileEmbed(info: ProfileInfo, cached = false): EmbedBuilder {
	const avatarUrl = info.avatar
		? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=256`
		: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(info.id) >> 22n) % 6n)}.png`;

	const createdAt = new Date(Number((BigInt(info.id) >> 22n) + 1420070400000n));
	const createdTs = Math.floor(createdAt.getTime() / 1000);
	const accountAge = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

	return new EmbedBuilder()
		.setAuthor({
			name: cached ? 'Perfil • Auto Quest (cache)' : 'Perfil • Auto Quest',
			iconURL: avatarUrl,
		})
		.setTitle(`${info.global_name ?? info.username}`)
		.setDescription(
			`**Nick:** \`${info.username}\`\n` +
				`**ID:** \`${info.id}\`\n\n` +
				`${EMOJI_LIGHTNING} **Quests disponíveis:** \`${info.quests}\``
		)
		.addFields(
			{
				name: '📅 Criada em',
				value: `<t:${createdTs}:F> (<t:${createdTs}:R>)`,
				inline: false,
			},
			{ name: '🕒 Idade da conta', value: `${accountAge} dias`, inline: true },
			{ name: '📊 Status', value: cached ? '⚠️ Cache' : '✅ Ativa e conectada', inline: true }
		)
		.setColor(cached ? COLORS.WARNING : COLORS.SUCCESS)
		.setThumbnail(avatarUrl)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
		.setTimestamp();
}

// ============================================================
// STATS EMBED
// ============================================================
function statsEmbed(acc: Account): EmbedBuilder {
	const avatarUrl = acc.avatar
		? `https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png?size=256`
		: acc.id
		? `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(acc.id) >> 22n) % 6n)}.png`
		: LOGO_URL;

	return new EmbedBuilder()
		.setAuthor({ name: 'Estatísticas • Auto Quest', iconURL: avatarUrl })
		.setTitle(`📊 @${acc.username ?? 'conta'}`)
		.setDescription(
			`**ID:** \`${acc.id ?? 'desconhecido'}\`\n` +
				`**Última execução:** ${
					acc.lastUpdate
						? `<t:${Math.floor(new Date(acc.lastUpdate).getTime() / 1000)}:R>`
						: 'nunca'
				}\n` +
				`**Última contagem:** \`${acc.lastQuests ?? 0}\` quests\n` +
				`**Token:** ${acc.token ? '✅ salvo' : '❌ ausente'}`
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
	console.log(`🗑️ Auto-delete: ${AUTO_DELETE_MS / 1000}s`);
	logToFile('INFO', `Bot online: ${client.user?.tag}`);

	try {
		const e1 = await client.emojis.fetch(ROCKET_ID);
		console.log(`✅ Emoji foguete: ${e1.name}`);
	} catch {
		console.warn('⚠️ Emoji foguete não acessível');
	}
	try {
		const e2 = await client.emojis.fetch(LIGHTNING_ID);
		console.log(`✅ Emoji trovão: ${e2.name}`);
	} catch {
		console.warn('⚠️ Emoji trovão não acessível');
	}
	try {
		const e3 = await client.emojis.fetch(QUEST_ICON_ID);
		console.log(`✅ Emoji quest icon: ${e3.name}`);
	} catch {
		console.warn('⚠️ Emoji quest icon não acessível');
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
	].map((c) => c.toJSON());

	const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
	try {
		await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), { body: [] });
		const data = (await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), {
			body: commands,
		})) as any[];
		console.log(`✅ ${data.length} comandos registrados na guild ${GUILD_ID}`);
	} catch (e: any) {
		console.error('❌ Erro registrando:', e?.message);
		logToFile('ERROR', `registerCommands: ${e?.message}`);
	}
});

// ============================================================
// VERIFY ACCOUNT (com timeout 180s e captura do ÚLTIMO JSON)
// ============================================================
interface ProfileInfo {
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	quests: number;
}

async function verifyAccount(token: string): Promise<ProfileInfo | null> {
	return new Promise((resolve) => {
		let profileJson: string | null = null;
		let finished = false;

		const finish = (val: ProfileInfo | null) => {
			if (finished) return;
			finished = true;
			resolve(val);
		};

		let child: ReturnType<typeof runBot> | null = null;
		try {
			child = runBot(
				token,
				'profile',
				(line) => {
					const m = line.match(/__PROFILE_JSON_START__\s*(.+?)\s*__PROFILE_JSON_END__/);
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

		// ✅ 180s (evita timeout em conexões lentas)
		setTimeout(() => {
			if (finished) return;
			try {
				child?.kill('SIGTERM');
			} catch {
				/* ignore */
			}
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
// HANDLE LOGIN
// ============================================================
async function handleLogin(interaction: any, user: any, token: string) {
	if (token.length < 30 || token.split('.').length < 3) {
		await interaction.reply({ content: '❌ Token inválido.', flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('deferReply falhou:', e);
		return;
	}

	const existing = getAccount(user.id);
	saveAccount(user.id, { ...(existing ?? {}), token });

	try {
		await interaction.editReply({ content: `${EMOJI_LIGHTNING} Verificando token...` });
	} catch (e) {
		console.error('editReply falhou:', e);
	}

	console.log(`🔍 Verificando token para ${user.tag}...`);
	const info = await verifyAccount(token);

	if (info) {
		saveAccount(user.id, {
			...(existing ?? {}),
			token,
			username: info.username,
			id: info.id,
			avatar: info.avatar ?? undefined,
			lastQuests: info.quests,
			lastUpdate: new Date().toISOString(),
		});

		try {
			await interaction.editReply({
				content: '',
				embeds: [profileEmbed(info, false)],
			});
		} catch (e) {
			console.error('editReply sucesso falhou:', e);
		}
		logToFile('INFO', `Login OK: ${user.tag} -> @${info.username}`);
		return;
	}

	// Fallback: cache
	if (existing?.username && existing?.id) {
		const cachedInfo: ProfileInfo = {
			id: existing.id,
			username: existing.username,
			global_name: null,
			avatar: existing.avatar ?? null,
			quests: existing.lastQuests ?? 0,
		};

		try {
			await interaction.editReply({
				content: '',
				embeds: [profileEmbed(cachedInfo, true)],
			});
		} catch (e) {
			console.error('editReply cache falhou:', e);
		}
		return;
	}

	try {
		await interaction.editReply({
			content:
				`${EMOJI_ROCKET} **Token salvo**\n\n` +
				`Não consegui verificar agora. Tente novamente em alguns minutos.`,
			flags: MessageFlags.Ephemeral,
		});
	} catch (e) {
		console.error('editReply offline falhou:', e);
	}
}

// ============================================================
// HANDLE PROFILE (botão)
// ============================================================
async function handleProfile(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}

	try {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
	} catch (e) {
		console.error('deferReply perfil falhou:', e);
		return;
	}

	try {
		await interaction.editReply({ content: '⏳ Carregando perfil...' });
	} catch {
		/* ignore */
	}

	const info = await verifyAccount(acc.token);

	if (info) {
		saveAccount(user.id, {
			...acc,
			username: info.username,
			id: info.id,
			avatar: info.avatar ?? undefined,
			lastQuests: info.quests,
			lastUpdate: new Date().toISOString(),
		});

		try {
			await interaction.editReply({
				content: '',
				embeds: [profileEmbed(info, false)],
			});
		} catch (e) {
			console.error('editReply perfil falhou:', e);
		}
		return;
	}

	if (acc.username && acc.id) {
		const cachedInfo: ProfileInfo = {
			id: acc.id,
			username: acc.username,
			global_name: null,
			avatar: acc.avatar ?? null,
			quests: acc.lastQuests ?? 0,
		};

		try {
			await interaction.editReply({
				content: '',
				embeds: [profileEmbed(cachedInfo, true)],
			});
		} catch (e) {
			console.error('editReply perfil cache falhou:', e);
		}
		return;
	}

	try {
		await interaction.editReply({
			content: '⚠️ Não foi possível carregar o perfil. Tente novamente.',
		});
	} catch {
		/* ignore */
	}
}

// ============================================================
// HANDLE AUTO-QUEST (CORRIGIDO — sem duplicação)
// ============================================================
async function handleAutoQuest(interaction: any, user: any, mode: Mode) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}
	if (runningUsers.has(user.id)) {
		await interaction.reply({
			content: '⏳ Já em execução.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	runningUsers.add(user.id);
	const startTime = Date.now();
	const accountName = acc.username || 'conta';

	const modeLabel =
		mode === 'sequential_no_delay'
			? '🚀 1 por 1 (rápido)'
			: mode === 'sequential_delay'
			? '🚀 1 por 1 (delay 3 min)'
			: mode === 'all_parallel'
			? '⚡ Paralelo'
			: '⚡ Série com delay';

	const channel = interaction.channel;

	await interaction.reply({
		embeds: [
			new EmbedBuilder()
				.setAuthor({ name: `Executando • @${accountName}`, iconURL: LOGO_URL })
				.setTitle(`${EMOJI_LIGHTNING} Auto-Quest Iniciado!`)
				.setDescription(`**Modo:** ${modeLabel}\n\nAcompanhe aqui no canal.`)
				.setColor(COLORS.PURPLE)
				.setImage(BANNER_URL)
				.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL })
				.setTimestamp(),
		],
	});

	logToFile('INFO', `Auto-Quest iniciado: ${user.tag} @${accountName} modo=${mode}`);

	let completedCount = 0;
	let failedCount = 0;
	let totalCount = 0;

	// ✅ CORRIGIDO: guarda a mensagem POR QUEST (id → Message)
	const progressMessages = new Map<string, any>();
	const liveQuests = new Map<string, LiveQuest>();

	const child = runBot(
		acc.token,
		mode,
		async (line) => {
			try {
				const foundMatch = line.match(/Found (\d+) valid quests/);
				if (foundMatch) {
					totalCount = parseInt(foundMatch[1], 10);
					await sendAutoDelete(channel, `${EMOJI_LIGHTNING} Detectei **${totalCount}** quest(s).`);
				}

				const startMatch = line.match(/\[(\d+)\/(\d+)\]\s*Starting:\s*"(.+?)"/);
				if (startMatch) {
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({
									name: `Auto Quest • ${startMatch[1]}/${startMatch[2]}`,
									iconURL: LOGO_URL,
								})
								.setTitle(`${EMOJI_ROCKET} Iniciando: ${startMatch[3]}`)
								.setColor(COLORS.PURPLE)
								.setTimestamp(),
						],
					});
				}

				// QUEST_DATA — só ARMAZENA, não posta
				const dataMatch = line.match(/__QUEST_DATA__(\{.+?\})__QUEST_DATA__/);
				if (dataMatch) {
					try {
						const data = JSON.parse(dataMatch[1]);
						if (!liveQuests.has(data.id)) {
							liveQuests.set(data.id, data);
						} else {
							// Atualiza mantendo os dados originais
							const existing = liveQuests.get(data.id)!;
							existing.current = data.current;
							existing.total = data.total;
						}
					} catch {
						/* ignore */
					}
				}

				// PROGRESS_UPDATE — EDITA a mensagem existente (não cria nova)
				const progressMatch = line.match(/__PROGRESS_UPDATE__(\{.+?\})__PROGRESS_UPDATE__/);
				if (progressMatch) {
					try {
						const data = JSON.parse(progressMatch[1]);
						const existing = liveQuests.get(data.id);
						if (!existing) return;

						existing.current = data.current;
						existing.total = data.total;

						const embed = liveProgressEmbed(existing, accountName);
						const msg = progressMessages.get(data.id);

						if (msg) {
							// ✅ Já tem mensagem → EDITA
							try {
								await msg.edit({ embeds: [embed] });
							} catch {
								// Se falhou (ex: mensagem deletada), cria nova
								const newMsg = await channel.send({ embeds: [embed] });
								progressMessages.set(data.id, newMsg);
							}
						} else {
							// ✅ Primeira vez → cria
							const newMsg = await channel.send({ embeds: [embed] });
							progressMessages.set(data.id, newMsg);
						}
					} catch (e) {
						console.error('Erro processando progress:', e);
					}
				}

				const doneMatch = line.match(/Completed:\s*"(.+?)"/);
				if (doneMatch) {
					completedCount++;
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: 'Auto Quest • Concluída', iconURL: LOGO_URL })
								.setTitle(`${EMOJI_ROCKET} ${doneMatch[1]}`)
								.setDescription(
									`Progresso: **${completedCount}** concluída(s)` +
										(failedCount > 0 ? ` • **${failedCount}** falha(s)` : '')
								)
								.setColor(COLORS.SUCCESS)
								.setTimestamp()
								.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
						],
					});
				}

				const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (failMatch) {
					failedCount++;
					await sendAutoDelete(channel, `❌ **Falhou:** ${failMatch[1]}`);
				}
			} catch (e) {
				console.error('Erro processando log:', e);
			}
		},
		async (code) => {
			runningUsers.delete(user.id);
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
						.setTitle(success ? `${EMOJI_ROCKET} Execução Finalizada!` : '❌ Execução com Falhas')
						.setDescription(
							`**Concluídas:** ✅ ${completedCount}\n` +
								`**Falhas:** ❌ ${failedCount}\n` +
								`**Total detectado:** ${totalCount}\n` +
								`**Duração:** ${duration} min`
						)
						.setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
						.setTimestamp()
						.setFooter({ text: 'Auto Quest • Fim', iconURL: LOGO_URL }),
				],
			});

			logToFile('INFO', `Finalizado: ${user.tag} OK=${completedCount} FAIL=${failedCount}`);

			clearQuestCache(user.id);
		}
	);

	setTimeout(() => {
		try {
			child.kill('SIGTERM');
		} catch {
			/* ignore */
		}
	}, 2 * 60 * 60 * 1000);
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

			if (commandName === 'deltoken') {
				removeAccount(user.id);
				clearQuestCache(user.id);
				await interaction.reply({ content: '🗑️ Token removido.', flags: MessageFlags.Ephemeral });
				return;
			}

			if (commandName === 'stats') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}
				await interaction.reply({ embeds: [statsEmbed(acc)], flags: MessageFlags.Ephemeral });
				return;
			}

			if (commandName === 'perfil') {
				await handleProfile(interaction, user);
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
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}
				await interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: 'Auto Quest • Modo', iconURL: LOGO_URL })
							.setTitle(`${EMOJI_LIGHTNING} Escolha o modo`)
							.setDescription(
								'🚀 **1 por 1 (rápido)** — Sem delay\n' +
									'🚀 **1 por 1 (delay 3min)** — Recomendado\n' +
									'⚡ **Todas de vez** — Paralelo\n' +
									'⚡ **Todas c/ delay** — Série'
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

			if (customId === 'profile') {
				await handleProfile(interaction, user);
				return;
			}

			if (customId.startsWith('mode_')) {
				const mode = customId.replace('mode_', '') as Mode;
				await handleAutoQuest(interaction, user, mode);
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
				await interaction.reply({
					content: '❌ Erro interno.',
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));
