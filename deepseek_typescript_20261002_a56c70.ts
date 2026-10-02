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

// ============================================================
// EMOJIS
// ============================================================
const EMOJI_ROCKET = '🚀';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_ORB = '🔮';
const EMOJI_AUTO = '🤖';

const ROCKET_ID = '1555258534441259148';
const ROCKET_NAME = '270171rocket';
const LIGHTNING_ID = '1555258800301154374';
const LIGHTNING_NAME = '653548lightning';

const ROCKET_BTN = { id: ROCKET_ID, name: ROCKET_NAME, animated: true };
const LIGHTNING_BTN = { id: LIGHTNING_ID, name: LIGHTNING_NAME, animated: true };

// ============================================================
// BANNER
// ============================================================
const BANNER_URL =
	'https://cdn.discordapp.com/attachments/1552448890656137297/1555470801904345108/1790923506283.jpg?backend=b2&ex=6ac0a492&is=6abf5312&hm=32123b4e477083c1ae208e41538c64230f08ac1d73a9eab19572c16650bac471&';
const LOGO_URL = process.env.LOGO_URL || BANNER_URL;

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
// AUTO-DELETE HELPER
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
	autoPilot?: boolean;
	autoPilotStartedAt?: string;
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

function getAllAccounts(): Record<string, Account> {
	return loadFromDisk();
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

// ============================================================
// EMBEDS
// ============================================================
function mainPanelEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
		.setTitle('Auto Quest')
		.setDescription(
			'**Bem-vindo ao Auto Quest**\n\n' +
				`${EMOJI_ROCKET} **Login** — Cole o token da sua conta Discord.\n` +
				`${EMOJI_LIGHTNING} **Auto-Quest** — Executa manualmente todas as quests agora.\n` +
				`${EMOJI_AUTO} **Auto-Pilot** — Deixa o bot rodar sozinho 24/7 automaticamente.`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Sistema Automático', iconURL: LOGO_URL })
		.setTimestamp();
}

function mainPanelButtons(userId: string): ActionRowBuilder<ButtonBuilder>[] {
	const acc = getAccount(userId);
	const autoPilotActive = acc?.autoPilot === true;

	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('login')
			.setLabel('Login')
			.setEmoji(ROCKET_BTN)
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('autoquest')
			.setLabel('Auto-Quest')
			.setEmoji(LIGHTNING_BTN)
			.setStyle(ButtonStyle.Primary)
	);
	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('autopilot_toggle')
			.setLabel(autoPilotActive ? 'Auto-Pilot: ON' : 'Auto-Pilot: OFF')
			.setEmoji(EMOJI_AUTO)
			.setStyle(autoPilotActive ? ButtonStyle.Success : ButtonStyle.Secondary)
	);

	return [row1, row2];
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

interface LiveQuest {
	name: string;
	game: string;
	hero: string | null;
	current: number;
	total: number;
	task: string;
	orbs: number;
	rewardName: string | null;
}

function liveProgressEmbed(quest: LiveQuest, accountName: string): EmbedBuilder {
	const safeTotal = quest.total > 0 ? quest.total : 1;
	const percent = Math.min(100, Math.round((quest.current / safeTotal) * 100));

	const orbsLine =
		quest.orbs > 0
			? `${EMOJI_ORB} **Recompensa:** \`${quest.orbs}\` Orbs\n`
			: quest.rewardName
			? `🎁 **Recompensa:** ${quest.rewardName}\n`
			: '';

	const embed = new EmbedBuilder()
		.setAuthor({ name: `Auto Quest • @${accountName}`, iconURL: LOGO_URL })
		.setTitle(`${EMOJI_ROCKET} ${quest.name}`)
		.setDescription(
			`🎮 **Jogo:** ${quest.game}\n` +
				`📋 **Tipo:** ${quest.task}\n` +
				orbsLine +
				`\n**Progresso:**\n${progressBar(quest.current, quest.total)}\n\n` +
				`⏱️ ${quest.current}/${quest.total} • **${percent}%**`
		)
		.setColor(COLORS.PURPLE)
		.setFooter({ text: 'Auto Quest • Executando...', iconURL: LOGO_URL })
		.setTimestamp();

	if (quest.hero) {
		embed.setImage(`https://cdn.discordapp.com/${quest.hero}`);
	}
	return embed;
}

// ============================================================
// READY
// ============================================================
client.once('ready', async () => {
	console.log(`✅ ${client.user?.tag} online`);
	console.log(`🗑️ Auto-delete: ${AUTO_DELETE_MS / 1000}s`);
	console.log(`🤖 Auto-Pilot: aguardando 5s para iniciar loop...`);

	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar o token da sua conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('autopilot').setDescription('Ligar/desligar Auto-Pilot'),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover seu token'),
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

	// ✅ Inicia o Auto-Pilot
	setTimeout(startAutoPilotLoop, 5000);
});

// ============================================================
// AUTO-PILOT — roda a cada 10 minutos
// ============================================================
const AUTOPILOT_INTERVAL_MS = 10 * 60 * 1000;

function startAutoPilotLoop() {
	console.log('🤖 Auto-Pilot loop iniciado (a cada 10 min)');

	// Roda imediatamente
	runAutoPilotCycle();

	// Agenda próximo
	setInterval(runAutoPilotCycle, AUTOPILOT_INTERVAL_MS);
}

async function runAutoPilotCycle() {
	try {
		const all = getAllAccounts();
		const autoPilotUsers = Object.entries(all).filter(
			([_, acc]) => acc.autoPilot && acc.token
		);

		if (autoPilotUsers.length === 0) {
			console.log('🤖 Nenhum usuário com Auto-Pilot ativo');
			return;
		}

		console.log(`🤖 Iniciando ciclo do Auto-Pilot para ${autoPilotUsers.length} usuário(s)`);

		for (const [userId, acc] of autoPilotUsers) {
			if (runningUsers.has(userId)) continue;
			await runAutoPilotForUser(userId, acc);
		}
	} catch (e) {
		console.error('❌ Erro no ciclo Auto-Pilot:', e);
	}
}

async function runAutoPilotForUser(userId: string, acc: Account) {
	if (runningUsers.has(userId)) return;
	runningUsers.add(userId);

	console.log(`\n${'='.repeat(50)}`);
	console.log(`🤖 Auto-Pilot INICIADO para ${acc.username ?? userId}`);
	console.log(`${'='.repeat(50)}`);

	try {
		// 1. Verifica se a conta tem quests disponíveis
		console.log(`🤖 [1/3] Verificando conta...`);
		const info = await verifyAccount(acc.token);

		if (!info) {
			console.warn(`🤖 ❌ Falha ao verificar ${userId}`);
			runningUsers.delete(userId);
			return;
		}

		console.log(`🤖 [2/3] @${info.username} tem ${info.quests} quest(s)`);

		if (info.quests === 0) {
			console.log(`🤖 Sem quests, aguardando próximo ciclo`);
			saveAccount(userId, {
				...acc,
				username: info.username,
				id: info.id,
				lastQuests: 0,
				lastUpdate: new Date().toISOString(),
			});
			runningUsers.delete(userId);
			return;
		}

		saveAccount(userId, {
			...acc,
			username: info.username,
			id: info.id,
			lastQuests: info.quests,
			lastUpdate: new Date().toISOString(),
		});

		// 2. Notifica via DM que vai iniciar
		console.log(`🤖 [3/3] Executando quests...`);
		await sendAutoPilotDM(
			userId,
			`${EMOJI_AUTO} **Auto-Pilot: iniciando!**\n\n` +
				`Detectei **${info.quests}** quest(s) na conta @${info.username}.\n` +
				`Vou executar automaticamente.`
		);

		// 3. Roda as quests
		const completed: string[] = [];
		const failed: string[] = [];

		await new Promise<void>((resolve) => {
			const child = runBot(
				acc.token,
				'sequential_delay',
				async (line) => {
					console.log(`   [bot-log] ${line}`);

					const doneMatch = line.match(/Completed:\s*"(.+?)"/);
					if (doneMatch) {
						completed.push(doneMatch[1]);
						await sendAutoPilotDM(
							userId,
							`${EMOJI_ROCKET} **Quest concluída!**\n\`${doneMatch[1]}\`\n\n_(${completed.length}/${info.quests})_`
						);
					}

					const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
					if (failMatch) {
						failed.push(failMatch[1]);
						await sendAutoPilotDM(
							userId,
							`❌ **Quest falhou:** ${failMatch[1]}\n\`${failMatch[2].slice(0, 100)}\``
						);
					}
				},
				async (code, output, error) => {
					console.log(`🤖 [FIM] Code: ${code} | OK: ${completed.length} | Fail: ${failed.length}`);

					let summary = `${EMOJI_AUTO} **Auto-Pilot finalizado!**\n\n`;
					summary += `**Concluídas:** ✅ ${completed.length}\n`;
					summary += `**Falhas:** ❌ ${failed.length}\n`;

					if (completed.length > 0) {
						summary += '\n**Quests completadas:**\n';
						completed.slice(0, 10).forEach((n) => (summary += `• ${n}\n`));
					}

					summary += '\n> Próxima verificação em 10 min.';
					await sendAutoPilotDM(userId, summary);
					resolve();
				}
			);

			setTimeout(() => {
				console.warn('🤖 ⏰ Timeout de segurança');
				try {
					child.kill('SIGTERM');
				} catch {
					/* ignore */
				}
				resolve();
			}, 60 * 60 * 1000);
		});

		console.log(`🤖 Auto-Pilot FINALIZADO para ${acc.username ?? userId}`);
	} catch (e) {
		console.error(`❌ Erro Auto-Pilot ${userId}:`, e);
	} finally {
		runningUsers.delete(userId);
	}
}

// DM com auto-delete
async function sendAutoPilotDM(discordUserId: string, content: string) {
	try {
		const u = await client.users.fetch(discordUserId);
		const dm = await u.createDM();
		const msg = await dm.send({ content });
		setTimeout(async () => {
			try {
				await msg.delete();
			} catch {
				/* ignore */
			}
		}, AUTO_DELETE_MS);
	} catch (e: any) {
		console.warn(`⚠️ DM falhou para ${discordUserId}:`, e?.message ?? e);
	}
}

// ============================================================
// VERIFICAR CONTA (usado só pelo Auto-Pilot)
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
					if (m) profileJson = m[1];
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

		// ✅ 120s (era 60s)
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
		}, 120 * 1000);
	});
}

// ============================================================
// HANDLE LOGIN (simplificado — só salva o token)
// ============================================================
async function handleLogin(interaction: any, user: any, token: string) {
	if (token.length < 30 || token.split('.').length < 3) {
		await interaction.reply({ content: '❌ Token inválido.', flags: MessageFlags.Ephemeral });
		return;
	}

	const existing = getAccount(user.id);
	saveAccount(user.id, { ...(existing ?? {}), token });

	await interaction.reply({
		content:
			`${EMOJI_ROCKET} **Token salvo!**\n\n` +
			`Agora clique em ${EMOJI_AUTO} **Auto-Pilot** no painel para ativar a execução automática.\n\n` +
			`O bot vai rodar sozinho a cada **10 minutos**.`,
		flags: MessageFlags.Ephemeral,
	});
	console.log(`🔑 Token salvo para ${user.tag}`);
}

// ============================================================
// HANDLE AUTO-QUEST (manual)
// ============================================================
async function handleAutoQuest(interaction: any, user: any, mode: Mode) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', flags: MessageFlags.Ephemeral });
		return;
	}
	if (runningUsers.has(user.id)) {
		await interaction.reply({
			content: '⏳ Você já tem uma execução em andamento.',
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

	let completedCount = 0;
	let failedCount = 0;
	let totalCount = 0;
	let anyLog = false;
	let connectError = false;

	const progressMessages = new Map<string, any>();
	const liveQuests = new Map<string, LiveQuest>();

	const noLogTimer = setTimeout(async () => {
		if (anyLog) return;
		await sendAutoDelete(channel, {
			embeds: [
				new EmbedBuilder()
					.setTitle('⚠️ Bot ainda está iniciando...')
					.setColor(COLORS.WARNING)
					.setTimestamp(),
			],
		});
	}, 60 * 1000);

	const child = runBot(
		acc.token,
		mode,
		async (line) => {
			anyLog = true;
			try {
				if (
					line.includes('Error during client connection') ||
					line.includes('401') ||
					line.includes('WebSocket')
				) {
					connectError = true;
				}

				const foundMatch = line.match(/Found (\d+) valid quests/);
				if (foundMatch) {
					totalCount = parseInt(foundMatch[1], 10);
					await sendAutoDelete(channel, `${EMOJI_LIGHTNING} Detectei **${totalCount}** quest(s).`);
				}

				const startMatch = line.match(/\[(\d+)\/(\d+)\]\s*Starting:\s*"(.+?)"/);
				if (startMatch) {
					const idx = parseInt(startMatch[1], 10);
					const total = parseInt(startMatch[2], 10);
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: `Auto Quest • ${idx}/${total}`, iconURL: LOGO_URL })
								.setTitle(`${EMOJI_ROCKET} Iniciando: ${startMatch[3]}`)
								.setColor(COLORS.PURPLE)
								.setTimestamp(),
						],
					});
				}

				const dataMatch = line.match(/__QUEST_DATA__(\{.+?\})__QUEST_DATA__/);
				if (dataMatch) {
					try {
						const data = JSON.parse(dataMatch[1]);
						liveQuests.set(data.id, {
							name: data.name,
							game: data.game,
							hero: data.hero,
							current: data.current,
							total: data.total,
							task: data.task,
							orbs: data.orbs ?? 0,
							rewardName: data.rewardName ?? null,
						});
					} catch {
						/* ignore */
					}
				}

				const progressMatch = line.match(/__PROGRESS_UPDATE__(\{.+?\})__PROGRESS_UPDATE__/);
				if (progressMatch) {
					try {
						const data = JSON.parse(progressMatch[1]);
						const existing = liveQuests.get(data.id);
						if (existing) {
							existing.current = data.current;
							existing.total = data.total;
							const embed = liveProgressEmbed(existing, accountName);
							const msg = progressMessages.get(data.id);
							if (msg) {
								try {
									await msg.edit({ embeds: [embed] });
								} catch {
									const newMsg = await channel.send({ embeds: [embed] });
									progressMessages.set(data.id, newMsg);
								}
							} else {
								const newMsg = await channel.send({ embeds: [embed] });
								progressMessages.set(data.id, newMsg);
							}
						}
					} catch {
						/* ignore */
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
								.setDescription(`Progresso: **${completedCount}** concluída(s)`)
								.setColor(COLORS.SUCCESS)
								.setTimestamp(),
						],
					});
				}

				const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (failMatch) {
					failedCount++;
					await sendAutoDelete(channel, `❌ **Falhou:** ${failMatch[1]}`);
				}
			} catch {
				/* ignore */
			}
		},
		async (code) => {
			clearTimeout(noLogTimer);
			runningUsers.delete(user.id);
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);

			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
						.setTitle(`${EMOJI_ROCKET} Finalizado!`)
						.setDescription(
							`**Concluídas:** ✅ ${completedCount}\n` +
								`**Falhas:** ❌ ${failedCount}\n` +
								`**Total:** ${totalCount}\n` +
								`**Duração:** ${duration} min`
						)
						.setColor(COLORS.SUCCESS)
						.setTimestamp(),
				],
			});
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
					components: mainPanelButtons(user.id),
				});
				return;
			}

			if (commandName === 'token') {
				const tk = interaction.options.getString('token', true).trim();
				await handleLogin(interaction, user, tk);
				return;
			}

			if (commandName === 'autopilot') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}
				const newState = !acc.autoPilot;
				saveAccount(user.id, {
					...acc,
					autoPilot: newState,
					autoPilotStartedAt: newState ? new Date().toISOString() : undefined,
				});
				await interaction.reply({
					content: newState
						? `${EMOJI_AUTO} **Auto-Pilot ATIVADO!**\n\nO bot vai rodar a cada 10 min.`
						: `${EMOJI_AUTO} **Auto-Pilot DESATIVADO.**`,
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (commandName === 'deltoken') {
				removeAccount(user.id);
				await interaction.reply({ content: '🗑️ Token removido.', flags: MessageFlags.Ephemeral });
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

			if (customId === 'autopilot_toggle') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						flags: MessageFlags.Ephemeral,
					});
					return;
				}
				const newState = !acc.autoPilot;
				saveAccount(user.id, {
					...acc,
					autoPilot: newState,
					autoPilotStartedAt: newState ? new Date().toISOString() : undefined,
				});
				await interaction.reply({
					content: newState
						? `${EMOJI_AUTO} **Auto-Pilot ATIVADO!**\n\nVou rodar a cada 10 min automaticamente.`
						: `${EMOJI_AUTO} **Auto-Pilot DESATIVADO.**`,
					flags: MessageFlags.Ephemeral,
				});
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
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: '❌ Erro interno. Veja o console.',
					flags: MessageFlags.Ephemeral,
				});
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));