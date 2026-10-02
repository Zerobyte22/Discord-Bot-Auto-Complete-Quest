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
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GUILD_ID = '1555393892399185960';
const EMOJI = '👻';

// ============================================================
// BANNER GIF
// ============================================================
const BANNER_URL =
	'https://cdn.discordapp.com/attachments/1552448890656137297/1555453870791069776/0cb8780082d2e46710a73f06c51285bb.gif?backend=b2&ex=6ac094cd&is=6abf434d&hm=8062b124189aa05081c4c6f9758042c2b596a9ad3cdcf897c86e06cae0754455&';
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
// CHILD PROCESS
// ============================================================
type Mode = 'sequential_delay' | 'all_parallel' | 'all_delay';

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
				`${EMOJI} **Login** — Cole o token da sua conta Discord.\n` +
				`${EMOJI} **Auto-Quest** — Detecta e executa todas as quests automaticamente.\n` +
				`${EMOJI} **Perfil** — Veja os dados reais da conta logada.`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Sistema Automático', iconURL: LOGO_URL })
		.setTimestamp();
}

function mainPanelButtons(): ActionRowBuilder<ButtonBuilder>[] {
	const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('login').setLabel('Login').setEmoji(EMOJI).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('autoquest')
			.setLabel('Auto-Quest')
			.setEmoji(EMOJI)
			.setStyle(ButtonStyle.Primary)
	);
	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder().setCustomId('profile').setLabel('Perfil').setEmoji(EMOJI).setStyle(ButtonStyle.Secondary)
	);
	return [row1, row2];
}

function modeSelectButtons(): ActionRowBuilder<ButtonBuilder>[] {
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId('mode_sequential_delay')
				.setLabel('1 por 1 (delay)')
				.setEmoji('🐢')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId('mode_all_parallel')
				.setLabel('Todas de vez')
				.setEmoji('⚡')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId('mode_all_delay')
				.setLabel('Todas c/ delay')
				.setEmoji('⏱️')
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
	const percent = Math.min(100, Math.round((current / total) * 100));
	const filled = Math.round((percent / 100) * length);
	const empty = length - filled;
	const bar = '█'.repeat(filled) + '░'.repeat(empty);
	return `\`[${bar}]\` **${percent}%**`;
}

// ============================================================
// LIVE PROGRESS EMBED
// ============================================================
interface LiveQuest {
	name: string;
	game: string;
	hero: string | null;
	current: number;
	total: number;
	task: string;
}

function liveProgressEmbed(quest: LiveQuest, user: any): EmbedBuilder {
	const percent = Math.min(100, Math.round((quest.current / quest.total) * 100));

	const embed = new EmbedBuilder()
		.setAuthor({
			name: `Auto Quest • ${user.tag}`,
			iconURL: user.displayAvatarURL(),
		})
		.setTitle(`${EMOJI} ${quest.name}`)
		.setDescription(
			`🎮 **Jogo:** ${quest.game}\n` +
				`📋 **Tipo:** ${quest.task}\n\n` +
				`**Progresso:**\n${progressBar(quest.current, quest.total)}\n\n` +
				`⏱️ ${quest.current}/${quest.total}s • **${percent}%**`
		)
		.setColor(COLORS.PURPLE)
		.setFooter({ text: 'Auto Quest • Executando...', iconURL: LOGO_URL })
		.setTimestamp();

	// Banner da quest (hero)
	if (quest.hero) {
		const heroUrl = `https://cdn.discordapp.com/${quest.hero}`;
		embed.setImage(heroUrl);
	}

	return embed;
}

// ============================================================
// READY
// ============================================================
client.once('ready', async () => {
	console.log(`✅ ${client.user?.tag} online`);

	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar o token da sua conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('mytoken').setDescription('Ver status do token'),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover seu token'),
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
});

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
		}, 12 * 1000);
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

	saveAccount(user.id, { token });

	try {
		await interaction.editReply({ content: '⏳ Verificando token...' });
	} catch (e) {
		console.error('editReply falhou:', e);
	}

	const info = await verifyAccount(token);

	if (info) {
		saveAccount(user.id, {
			token,
			username: info.username,
			id: info.id,
			avatar: info.avatar ?? undefined,
			lastQuests: info.quests,
			lastUpdate: new Date().toISOString(),
		});

		try {
			await interaction.editReply({
				content:
					`${EMOJI} **Conta conectada!**\n\n` +
					`**Username:** @${info.username}\n` +
					`**ID:** \`${info.id}\`\n` +
					`**Quests disponíveis:** ${info.quests}`,
			});
		} catch (e) {
			console.error('editReply sucesso falhou:', e);
		}
	} else {
		try {
			await interaction.editReply({
				content:
					`${EMOJI} **Token salvo** (verificação offline).\n\n` +
					`Use **Auto-Quest** para tentar executar.`,
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

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Perfil • Auto Quest', iconURL: avatarUrl })
					.setTitle('Conta conectada')
					.setDescription(
						`**${info.global_name ?? info.username}** (\`${info.username}\`)\n` +
							`**ID:** \`${info.id}\`\n\n` +
							`${EMOJI} **Quests disponíveis:** \`${info.quests}\``
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

		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Perfil • Auto Quest', iconURL: avatarUrl })
					.setTitle('Conta (cache offline)')
					.setDescription(
						`**${acc.username}**\n` +
							`**ID:** \`${acc.id}\`\n\n` +
							`${EMOJI} **Última contagem:** \`${acc.lastQuests ?? 0}\``
					)
					.setColor(COLORS.WARNING)
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
				.setDescription('O `bot.ts` não respondeu em 12s.')
				.setColor(COLORS.ERROR)
				.setTimestamp(),
		],
	});
}

// ============================================================
// HANDLE AUTO-QUEST — com progresso em tempo real
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

	const modeLabel =
		mode === 'sequential_delay'
			? '🐢 1 por 1 (delay 3 min)'
			: mode === 'all_parallel'
			? '⚡ Paralelo'
			: '⏱️ Série com delay';

	const channel = interaction.channel;

	await interaction.reply({
		embeds: [
			new EmbedBuilder()
				.setAuthor({ name: `Executando para ${user.tag}`, iconURL: user.displayAvatarURL() })
				.setTitle(`${EMOJI} Auto-Quest Iniciado!`)
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
	let claimedCount = 0;
	let anyLog = false;
	let connectError = false;

	// Mapa de mensagens de progresso por quest (id → Message)
	const progressMessages = new Map<string, any>();

	// Live state por quest (id → dados da quest)
	const liveQuests = new Map<string, LiveQuest>();

	const noLogTimer = setTimeout(async () => {
		if (anyLog) return;
		await channel.send({
			embeds: [
				new EmbedBuilder()
					.setTitle('⚠️ Bot não respondeu em 30s')
					.setDescription('O `bot.ts` não conseguiu conectar ao Discord em 30s.')
					.setColor(COLORS.WARNING)
					.setTimestamp(),
			],
		});
	}, 30 * 1000);

	const child = runBot(
		acc.token,
		mode,
		async (line) => {
			anyLog = true;
			try {
				// ---- Detecta erro de conexão ----
				if (
					line.includes('Error during client connection') ||
					line.includes('401') ||
					line.includes('WebSocket') ||
					line.includes('ECONNREFUSED') ||
					line.includes('fetch failed')
				) {
					connectError = true;
				}

				// ---- Total de quests ----
				const foundMatch = line.match(/Found (\d+) valid quests/);
				if (foundMatch) {
					totalCount = parseInt(foundMatch[1], 10);
					await channel.send(`🔍 Detectei **${totalCount}** quest(s). Iniciando...`);
				}

				// ---- Quest começou ----
				const startMatch = line.match(/\[(\d+)\/(\d+)\]\s*Starting:\s*"(.+?)"/);
				if (startMatch) {
					const total = parseInt(startMatch[2], 10);
					const idx = parseInt(startMatch[1], 10);
					const name = startMatch[3];

					await channel.send({
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: `Auto Quest • ${idx}/${total}`, iconURL: LOGO_URL })
								.setTitle(`${EMOJI} Iniciando: ${name}`)
								.setDescription('Aceitando quest...')
								.setColor(COLORS.PURPLE)
								.setTimestamp(),
						],
					});
				}

				// ---- QUEST_DATA (JSON estruturado do bot.ts) ----
				const dataMatch = line.match(/__QUEST_DATA__(\{.+?\})__QUEST_DATA__/);
				if (dataMatch) {
					try {
						const data = JSON.parse(dataMatch[1]);
						// Cria/atualiza a entrada da quest
						liveQuests.set(data.id, {
							name: data.name,
							game: data.game,
							hero: data.hero,
							current: data.current,
							total: data.total,
							task: data.task,
						});
					} catch (e) {
						console.error('Erro parseando QUEST_DATA:', e);
					}
				}

				// ---- PROGRESS_UPDATE (JSON estruturado) ----
				const progressMatch = line.match(/__PROGRESS_UPDATE__(\{.+?\})__PROGRESS_UPDATE__/);
				if (progressMatch) {
					try {
						const data = JSON.parse(progressMatch[1]);
						const existing = liveQuests.get(data.id);
						if (existing) {
							existing.current = data.current;
							existing.total = data.total;

							// Atualiza o embed
							const embed = liveProgressEmbed(existing, user);
							const msg = progressMessages.get(data.id);

							if (msg) {
								try {
									await msg.edit({ embeds: [embed] });
								} catch {
									// Se falhou, cria nova
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

				// ---- QUEST_DONE ----
				const doneMatch = line.match(/Completed:\s*"(.+?)"/);
				if (doneMatch) {
					completedCount++;
					await channel.send({
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: 'Auto Quest • Concluída', iconURL: LOGO_URL })
								.setTitle(`✅ ${doneMatch[1]}`)
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

				// ---- QUEST_FAILED ----
				const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (failMatch) {
					failedCount++;
					await channel.send(
						`❌ **Falhou:** ${failMatch[1]}\n**Erro:** \`${failMatch[2].slice(0, 150)}\``
					);
				}

				// ---- CLAIM ----
				const claimMatch = line.match(/Claimed:\s*"(.+?)"/);
				if (claimMatch) {
					claimedCount++;
					await channel.send({
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: 'Auto Quest • Recompensa', iconURL: LOGO_URL })
								.setTitle(`🎁 ${claimMatch[1]}`)
								.setDescription(`Recompensa resgatada com sucesso!\n**Total resgatadas:** ${claimedCount}`)
								.setColor(COLORS.SUCCESS)
								.setTimestamp()
								.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
						],
					});
				}

				const claimFail = line.match(/Claim failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (claimFail) {
					await channel.send(
						`⚠️ **Falha ao resgatar:** ${claimFail[1]}\n\`${claimFail[2].slice(0, 150)}\``
					);
				}

				if (line.includes('Waiting 3 min')) {
					await channel.send('⏳ Aguardando **3 minutos** antes da próxima quest...');
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

			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado — ${user.tag}`, iconURL: user.displayAvatarURL() })
						.setTitle(success ? `${EMOJI} Execução Finalizada!` : '❌ Execução com Falhas')
						.setDescription(
							`**Concluídas:** ✅ ${completedCount}\n` +
								`**Falhas:** ❌ ${failedCount}\n` +
								`**Recompensas resgatadas:** 🎁 ${claimedCount}\n` +
								`**Total detectado:** ${totalCount}\n` +
								`**Duração:** ${duration} min`
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

			if (commandName === 'mytoken') {
				const acc = getAccount(user.id);
				await interaction.reply({
					content: acc
						? `${EMOJI} Token salvo${acc.username ? ` (@${acc.username})` : ''}.`
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
							.setTitle(`${EMOJI} Escolha o modo de execução`)
							.setDescription(
								'🐢 **1 por 1** — Uma quest por vez com 3 min de delay\n' +
									'⚡ **Todas de vez** — Executa todas em paralelo (mais rápido)\n' +
									'⏱️ **Todas c/ delay** — Uma por vez em série, 3 min cada'
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
