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

// ✅ Tempo de auto-delete (2 minutos)
const AUTO_DELETE_MS = 2 * 60 * 1000;

// ============================================================
// EMOJIS
// ============================================================
const EMOJI_ROCKET = '🚀';
const EMOJI_LIGHTNING = '⚡';
const EMOJI_GIFT = '🎁';
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
// Envia mensagem e apaga após AUTO_DELETE_MS
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
				/* mensagem já deletada ou sem permissão */
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
type Mode =
	| 'sequential_no_delay'
	| 'sequential_delay'
	| 'all_parallel'
	| 'all_delay'
	| 'claim_only'
	| 'profile';

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

	child.on('close', (code) => onDone(code ?? 1, fullOutput, errorOutput));
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
	GOLD: 0xfee75c,
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
				`${EMOJI_LIGHTNING} **Auto-Quest** — Detecta e executa todas as quests automaticamente.\n` +
				`${EMOJI_ROCKET} **Perfil** — Veja os dados reais da conta logada.\n` +
				`${EMOJI_GIFT} **Resgatar** — Coleta as recompensas das quests já concluídas.\n` +
				`${EMOJI_AUTO} **Auto-Pilot** — Faça o bot rodar sozinho 24/7.`
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
			.setCustomId('profile')
			.setLabel('Perfil')
			.setEmoji(ROCKET_BTN)
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('claim')
			.setLabel('Resgatar')
			.setEmoji(EMOJI_GIFT)
			.setStyle(ButtonStyle.Success)
	);
	const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('autopilot_toggle')
			.setLabel(autoPilotActive ? 'Auto-Pilot: ON' : 'Auto-Pilot: OFF')
			.setEmoji(EMOJI_AUTO)
			.setStyle(autoPilotActive ? ButtonStyle.Success : ButtonStyle.Secondary)
	);

	return [row1, row2, row3];
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
	const bar = '█'.repeat(filled) + '░'.repeat(empty);
	return `\`[${bar}]\` **${percent}%**`;
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
			? `${EMOJI_GIFT} **Recompensa:** ${quest.rewardName}\n`
			: `${EMOJI_GIFT} **Recompensa:** não informada\n`;

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
	console.log(`🗑️ Auto-delete de mensagens: ${AUTO_DELETE_MS / 1000}s`);

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

	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar o token da sua conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('mytoken').setDescription('Ver status do token'),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover seu token'),
		new SlashCommandBuilder().setName('autopilot').setDescription('Ativar/desativar Auto-Pilot'),
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
	}

	setTimeout(startAutoPilotLoop, 5000);
});

// ============================================================
// AUTO-PILOT
// ============================================================
const AUTOPILOT_INTERVAL_MS = 15 * 60 * 1000;

function startAutoPilotLoop() {
	console.log('🤖 Auto-Pilot loop iniciado');

	setInterval(async () => {
		try {
			const all = getAllAccounts();
			for (const [userId, acc] of Object.entries(all)) {
				if (!acc.autoPilot || !acc.token) continue;
				if (runningUsers.has(userId)) continue;

				console.log(`🤖 Auto-Pilot: rodando para ${acc.username ?? userId}`);
				await runAutoPilotForUser(userId, acc);
			}
		} catch (e) {
			console.error('❌ Erro no Auto-Pilot loop:', e);
		}
	}, AUTOPILOT_INTERVAL_MS);

	setTimeout(async () => {
		const all = getAllAccounts();
		for (const [userId, acc] of Object.entries(all)) {
			if (acc.autoPilot && acc.token && !runningUsers.has(userId)) {
				await runAutoPilotForUser(userId, acc);
			}
		}
	}, 10000);
}

async function runAutoPilotForUser(userId: string, acc: Account) {
	if (runningUsers.has(userId)) return;
	runningUsers.add(userId);

	try {
		const info = await verifyAccount(acc.token);

		if (!info) {
			console.warn(`🤖 Auto-Pilot: falha ao verificar conta ${userId}`);
			runningUsers.delete(userId);
			return;
		}

		if (info.quests === 0) {
			console.log(`🤖 Auto-Pilot: @${info.username} sem quests`);
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

		// ✅ DM com auto-delete de 2 min
		await sendAutoPilotDM(
			userId,
			`${EMOJI_AUTO} **Auto-Pilot: iniciando!**\n\n` +
				`Detectei **${info.quests}** quest(s) na conta @${info.username}.\n` +
				`Vou executar automaticamente.`
		);

		const completed: string[] = [];
		const failed: string[] = [];

		await new Promise<void>((resolve) => {
			const child = runBot(
				acc.token,
				'sequential_delay',
				async (line) => {
					// ✅ Auto-delete nas DMs de progresso
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
				async () => {
					let summary = `${EMOJI_AUTO} **Auto-Pilot finalizado!**\n\n`;
					summary += `**Concluídas:** ✅ ${completed.length}\n`;
					summary += `**Falhas:** ❌ ${failed.length}\n`;

					if (completed.length > 0) {
						summary += '\n**Quests completadas:**\n';
						completed.slice(0, 10).forEach((n) => (summary += `• ${n}\n`));
					}

					summary += '\n> Próxima verificação em 15 min.';
					await sendAutoPilotDM(userId, summary);
					resolve();
				}
			);

			setTimeout(() => {
				try {
					child.kill('SIGTERM');
				} catch {
					/* ignore */
				}
				resolve();
			}, 60 * 60 * 1000);
		});
	} catch (e) {
		console.error(`❌ Auto-Pilot erro para ${userId}:`, e);
	} finally {
		runningUsers.delete(userId);
	}
}

// ✅ DM com auto-delete
async function sendAutoPilotDM(discordUserId: string, content: string) {
	try {
		const u = await client.users.fetch(discordUserId);
		const dm = await u.createDM();
		const msg = await dm.send({ content });

		// ✅ Deleta após 2 min
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
// VERIFICAR CONTA
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
		}, 60 * 1000);
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

		const avatarUrl = info.avatar
			? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=256`
			: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(info.id) >> 22n) % 6n)}.png`;

		const createdAt = new Date(Number((BigInt(info.id) >> 22n) + 1420070400000n));
		const createdTs = Math.floor(createdAt.getTime() / 1000);
		const accountAge = Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24));

		try {
			await interaction.editReply({
				content: '',
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `${EMOJI_ROCKET} Conta conectada!`, iconURL: avatarUrl })
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
							{ name: '📊 Status', value: '✅ Ativa e conectada', inline: true }
						)
						.setColor(COLORS.SUCCESS)
						.setThumbnail(avatarUrl)
						.setImage(BANNER_URL)
						.setFooter({ text: 'Auto Quest • Login verificado', iconURL: LOGO_URL })
						.setTimestamp(),
				],
			});
		} catch (e) {
			console.error('editReply sucesso falhou:', e);
		}
	} else {
		try {
			await interaction.editReply({
				content: '',
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `${EMOJI_ROCKET} Token salvo`, iconURL: LOGO_URL })
						.setTitle('⚠️ Verificação offline')
						.setDescription(
							'O token foi salvo mas não foi possível verificar os dados agora.\n\n' +
								'Use **Auto-Quest** ou **Perfil** para tentar novamente.'
						)
						.setColor(COLORS.WARNING)
						.setImage(BANNER_URL)
						.setFooter({ text: 'Auto Quest • Login pendente', iconURL: LOGO_URL })
						.setTimestamp(),
				],
			});
		} catch (e) {
			console.error('editReply offline falhou:', e);
		}
	}
}

// ============================================================
// HANDLE PERFIL
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

		const avatarUrl = info.avatar
			? `https://cdn.discordapp.com/avatars/${info.id}/${info.avatar}.png?size=256`
			: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(info.id) >> 22n) % 6n)}.png`;

		const createdAt = new Date(Number((BigInt(info.id) >> 22n) + 1420070400000n));
		const createdTs = Math.floor(createdAt.getTime() / 1000);
		const autoPilotStatus = acc.autoPilot ? '🟢 Ativo' : '⚪ Desativado';

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Perfil • Auto Quest', iconURL: avatarUrl })
					.setTitle(`${info.global_name ?? info.username}`)
					.setDescription(
						`**Nick:** \`${info.username}\`\n` +
							`**ID:** \`${info.id}\`\n\n` +
							`${EMOJI_ROCKET} **Quests disponíveis:** \`${info.quests}\`\n` +
							`📅 **Criada:** <t:${createdTs}:R>\n` +
							`${EMOJI_AUTO} **Auto-Pilot:** ${autoPilotStatus}`
					)
					.setColor(COLORS.PURPLE)
					.setThumbnail(avatarUrl)
					.setImage(BANNER_URL)
					.setFooter({ text: 'Auto Quest • Perfil (ao vivo)', iconURL: LOGO_URL })
					.setTimestamp(),
			],
		});
		return;
	}

	if (acc.username && acc.id) {
		const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${Number(
			(BigInt(acc.id) >> 22n) % 6n
		)}.png`;
		const autoPilotStatus = acc.autoPilot ? '🟢 Ativo' : '⚪ Desativado';

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Perfil • Auto Quest', iconURL: avatarUrl })
					.setTitle(`${acc.username} (cache)`)
					.setDescription(
						`**ID:** \`${acc.id}\`\n\n` +
							`${EMOJI_ROCKET} **Última contagem:** \`${acc.lastQuests ?? 0}\`\n` +
							`${EMOJI_AUTO} **Auto-Pilot:** ${autoPilotStatus}\n` +
							`🕒 **Atualizado:** ${
								acc.lastUpdate
									? `<t:${Math.floor(new Date(acc.lastUpdate).getTime() / 1000)}:R>`
									: 'desconhecido'
							}`
					)
					.setColor(COLORS.WARNING)
					.setThumbnail(avatarUrl)
					.setImage(BANNER_URL)
					.setFooter({ text: 'Auto Quest • Perfil (offline)', iconURL: LOGO_URL })
					.setTimestamp(),
			],
		});
		return;
	}

	await interaction.editReply({
		embeds: [
			new EmbedBuilder()
				.setTitle('⚠️ Não foi possível verificar')
				.setDescription('O `bot.ts` não respondeu em 60s.')
				.setColor(COLORS.ERROR)
				.setTimestamp(),
		],
	});
}

// ============================================================
// HANDLE AUTO-QUEST (com auto-delete de 2 min)
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
			? '🚀 1 por 1 (rápido, sem delay)'
			: mode === 'sequential_delay'
			? '🚀 1 por 1 (delay 3 min)'
			: mode === 'all_parallel'
			? '⚡ Paralelo (mais rápido)'
			: '⚡ Série com delay';

	const channel = interaction.channel;

	// Aviso inicial NÃO é auto-deletado (fica no canal)
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
	let rateLimitWarned = false;

	const progressMessages = new Map<string, any>();
	const liveQuests = new Map<string, LiveQuest>();

	const noLogTimer = setTimeout(async () => {
		if (anyLog) return;
		await sendAutoDelete(channel, {
				embeds: [
					new EmbedBuilder()
						.setTitle('⚠️ Bot ainda está iniciando...')
						.setDescription('O `bot.ts` está iniciando no Render (demora ~30-60s).')
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
					line.includes('WebSocket') ||
					line.includes('ECONNREFUSED') ||
					line.includes('fetch failed')
				) {
					connectError = true;
				}

				if ((line.includes('RateLimit') || line.includes('rate limited')) && !rateLimitWarned) {
					rateLimitWarned = true;
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: '⚠️ Rate Limit', iconURL: LOGO_URL })
								.setTitle('⏳ Discord está limitando requisições')
								.setDescription('Use 🚀 **1 por 1 (delay 3 min)**')
								.setColor(COLORS.WARNING)
								.setTimestamp(),
						],
					});
				}

				const foundMatch = line.match(/Found (\d+) valid quests/);
				if (foundMatch) {
					totalCount = parseInt(foundMatch[1], 10);
					// ✅ Mensagem inicial da execução (auto-delete 2 min)
					await sendAutoDelete(
						channel,
						`${EMOJI_LIGHTNING} Detectei **${totalCount}** quest(s). Iniciando...`,
					);
				}

				const startMatch = line.match(/\[(\d+)\/(\d+)\]\s*Starting:\s*"(.+?)"/);
				if (startMatch) {
					const idx = parseInt(startMatch[1], 10);
					const total = parseInt(startMatch[2], 10);
					const name = startMatch[3];

					// ✅ Início da quest (auto-delete 2 min)
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: `Auto Quest • ${idx}/${total}`, iconURL: LOGO_URL })
								.setTitle(`${EMOJI_ROCKET} Iniciando: ${name}`)
								.setDescription('Aceitando quest...')
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
					} catch (e) {
						console.error('Erro parseando QUEST_DATA:', e);
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
					} catch (e) {
						console.error('Erro parseando PROGRESS_UPDATE:', e);
					}
				}

				// ✅ Quest concluída (auto-delete 2 min)
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

				// ✅ Falha (auto-delete 2 min)
				const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (failMatch) {
					failedCount++;
					await sendAutoDelete(
						channel,
						`❌ **Falhou:** ${failMatch[1]}\n**Erro:** \`${failMatch[2].slice(0, 150)}\``,
					);
				}

				if (line.includes('Waiting 3 min')) {
					await sendAutoDelete(channel, '⏳ Aguardando **3 minutos** antes da próxima quest...');
				}
			} catch (e) {
				console.error('Erro processando log:', e);
			}
		},
		async (code, output, error) => {
			clearTimeout(noLogTimer);
			runningUsers.delete(user.id);
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			if (connectError && totalCount === 0) {
				await channel.send({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ Não foi possível conectar')
							.setDescription('O bot não conseguiu conectar ao gateway do Discord.')
							.setColor(COLORS.ERROR)
							.setTimestamp(),
					],
				});
				return;
			}

			if (totalCount === 0) {
				await channel.send({
					embeds: [
						new EmbedBuilder()
							.setTitle('❌ Nenhuma quest disponível')
							.setDescription('A conta não tem quests ativas.')
							.setColor(COLORS.WARNING)
							.setTimestamp(),
					],
				});
				return;
			}

			// Resumo final NÃO é auto-deletado (fica no canal pra referência)
			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
						.setTitle(success ? `${EMOJI_ROCKET} Execução Finalizada!` : '❌ Execução com Falhas')
						.setDescription(
							`**Concluídas:** ✅ ${completedCount}\n` +
								`**Falhas:** ❌ ${failedCount}\n` +
								`**Total detectado:** ${totalCount}\n` +
								`**Duração:** ${duration} min\n\n` +
								`💡 Use **🎁 Resgatar** para coletar recompensas.`
						)
						.setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
						.setTimestamp()
						.setFooter({ text: 'Auto Quest • Fim', iconURL: LOGO_URL }),
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
// HANDLE CLAIM (com auto-delete)
// ============================================================
async function handleClaim(interaction: any, user: any) {
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
	const channel = interaction.channel;
	const accountName = acc.username || 'conta';

	await interaction.reply({
		embeds: [
			new EmbedBuilder()
				.setAuthor({ name: `Resgatando • @${accountName}`, iconURL: LOGO_URL })
				.setTitle(`${EMOJI_GIFT} Resgatando Recompensas...`)
				.setDescription('Verificando quests concluídas que ainda não foram resgatadas.')
				.setColor(COLORS.SUCCESS)
				.setImage(BANNER_URL)
				.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL })
				.setTimestamp(),
		],
	});

	let claimedCount = 0;
	let failedCount = 0;
	let captchaFailed = 0;
	let totalToClaim = 0;
	let anyLog = false;

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
		'claim_only',
		async (line) => {
			anyLog = true;
			try {
				const toClaimMatch = line.match(/Found (\d+) rewards to claim/);
				if (toClaimMatch) {
					totalToClaim = parseInt(toClaimMatch[1], 10);
					if (totalToClaim === 0) {
						await sendAutoDelete(channel, {
							embeds: [
								new EmbedBuilder()
									.setTitle(`${EMOJI_GIFT} Nenhuma recompensa para resgatar`)
									.setColor(COLORS.WARNING)
									.setTimestamp(),
							],
						});
					} else {
						await sendAutoDelete(
							channel,
							`${EMOJI_GIFT} Encontrei **${totalToClaim}** recompensa(s). Processando...`,
						);
					}
				}

				const claimMatch = line.match(/Claimed:\s*"(.+?)"/);
				if (claimMatch) {
					claimedCount++;
					// ✅ Auto-delete na DM/canal
					await sendAutoDelete(channel, {
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: 'Auto Quest • Resgatada', iconURL: LOGO_URL })
								.setTitle(`${EMOJI_GIFT} ${claimMatch[1]}`)
								.setDescription(
									`Recompensa coletada!\n**Total:** ${claimedCount}/${totalToClaim}`
								)
								.setColor(COLORS.SUCCESS)
								.setTimestamp()
								.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
						],
					});
				}

				const claimFail = line.match(/Claim failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (claimFail) {
					const err = claimFail[2];
					if (err.includes('Captcha') || err.includes('captcha')) {
						captchaFailed++;
					} else {
						failedCount++;
					}
				}
			} catch (e) {
				console.error('Erro processando log de claim:', e);
			}
		},
		async () => {
			clearTimeout(noLogTimer);
			runningUsers.delete(user.id);
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);

			if (totalToClaim === 0) return;

			let desc = `**Recompensas coletadas:** 🎁 ${claimedCount}\n`;
			if (captchaFailed > 0) desc += `**Requer captcha:** ⚠️ ${captchaFailed}\n`;
			if (failedCount > 0) desc += `**Outras falhas:** ❌ ${failedCount}\n`;
			desc += `\n**Total detectado:** ${totalToClaim}\n**Duração:** ${duration} min`;

			// Resumo final NÃO é auto-deletado
			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado • @${accountName}`, iconURL: LOGO_URL })
						.setTitle(`${EMOJI_GIFT} Resgate Finalizado!`)
						.setDescription(desc)
						.setColor(claimedCount > 0 ? COLORS.SUCCESS : COLORS.WARNING)
						.setTimestamp()
						.setFooter({ text: 'Auto Quest • Fim', iconURL: LOGO_URL }),
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
	}, 10 * 60 * 1000);
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

			if (commandName === 'mytoken') {
				const acc = getAccount(user.id);
				await interaction.reply({
					content: acc
						? `${EMOJI_ROCKET} Token salvo${acc.username ? ` (@${acc.username})` : ''}.`
						: '❌ Nenhum token.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (commandName === 'deltoken') {
				removeAccount(user.id);
				await interaction.reply({ content: '🗑️ Token removido.', flags: MessageFlags.Ephemeral });
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
						? `${EMOJI_AUTO} **Auto-Pilot ATIVADO!**\n\nO bot vai rodar a cada **15 minutos**.`
						: `${EMOJI_AUTO} **Auto-Pilot DESATIVADO.**`,
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
							.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL })
							.setTimestamp(),
					],
					components: modeSelectButtons(),
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			if (customId === 'claim') {
				await handleClaim(interaction, user);
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
						? `${EMOJI_AUTO} **Auto-Pilot ATIVADO!**`
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

			if (customId === 'profile') {
				await handleProfile(interaction, user);
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
