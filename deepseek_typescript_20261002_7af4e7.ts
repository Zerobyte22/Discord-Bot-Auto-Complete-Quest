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
	Interaction,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Guild ID atualizado
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
// STORAGE — com fallback em memória (Render-safe)
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
		console.log(`💾 Disco OK: ${Object.keys(store).length} usuário(s)`);
	} catch (e: any) {
		console.error('❌ ERRO AO ESCREVER:', e?.message ?? e);
		console.error('   → Usando memória temporária');
	}
}

function getAccount(discordId: string): Account | null {
	// 1) Memória primeiro (mais confiável)
	if (MEMORY_STORE[discordId]) return MEMORY_STORE[discordId];

	// 2) Disco
	const disk = loadFromDisk();
	if (disk[discordId]) {
		MEMORY_STORE[discordId] = disk[discordId];
		return disk[discordId];
	}
	return null;
}

function saveAccount(discordId: string, account: Account) {
	MEMORY_STORE[discordId] = account;
	console.log(`📝 saveAccount(${discordId}):`, {
		username: account.username,
		id: account.id,
	});

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

function modeSelectModal(): ModalBuilder {
	const modal = new ModalBuilder().setCustomId('modal_mode').setTitle('Escolher modo de execução');
	const select = new StringSelectMenuBuilder()
		.setCustomId('mode_picker')
		.setPlaceholder('Selecione o modo...')
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel('1 por 1 (com delay)')
				.setDescription('Uma por vez, 3 min de intervalo')
				.setValue('sequential_delay')
				.setEmoji('🐢'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Todas de uma vez (paralelo)')
				.setDescription('Executa todas simultaneamente')
				.setValue('all_parallel')
				.setEmoji('⚡'),
			new StringSelectMenuOptionBuilder()
				.setLabel('Todas com delay (3 min cada)')
				.setDescription('Uma por vez em série contínua')
				.setValue('all_delay')
				.setEmoji('⏱️')
		);
	modal.addComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
	return modal;
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
// VERIFICAR CONTA — timeout 12s
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
// HANDLE LOGIN (usado por /token e modal)
// ============================================================
async function handleLogin(interaction: any, user: any, token: string) {
	if (token.length < 30 || token.split('.').length < 3) {
		await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
		return;
	}

	try {
		await interaction.deferReply({ ephemeral: true });
	} catch (e) {
		console.error('deferReply falhou:', e);
		return;
	}

	// ✅ Salva IMEDIATAMENTE (mesmo antes de verificar)
	saveAccount(user.id, { token });

	try {
		await interaction.editReply({ content: '⏳ Verificando token...' });
	} catch (e) {
		console.error('editReply falhou:', e);
	}

	const info = await verifyAccount(token);

	if (info) {
		// ✅ Atualiza com dados reais
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
		try {
			await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
		} catch (e) {
			console.error('reply login falhou:', e);
		}
		return;
	}

	try {
		await interaction.deferReply({ ephemeral: true });
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

		try {
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
		} catch (e) {
			console.error('editReply perfil live falhou:', e);
		}
		return;
	}

	// Fallback: cache
	if (acc.username && acc.id) {
		const avatarUrl = `https://cdn.discordapp.com/embed/avatars/${Number(
			(BigInt(acc.id) >> 22n) % 6n
		)}.png`;

		try {
			await interaction.editReply({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: 'Perfil • Auto Quest', iconURL: avatarUrl })
						.setTitle('Conta (cache offline)')
						.setDescription(
							`**${acc.username}**\n` +
								`**ID:** \`${acc.id}\`\n\n` +
								`${EMOJI} **Última contagem:** \`${acc.lastQuests ?? 0}\`\n` +
								`🕒 **Atualizado:** ${
									acc.lastUpdate
										? `<t:${Math.floor(new Date(acc.lastUpdate).getTime() / 1000)}:R>`
										: 'desconhecido'
								}`
						)
						.setColor(COLORS.WARNING)
						.setImage(BANNER_URL)
						.setFooter({ text: 'Auto Quest • Perfil (offline)', iconURL: LOGO_URL })
						.setTimestamp(),
				],
			});
		} catch (e) {
			console.error('editReply perfil cache falhou:', e);
		}
		return;
	}

	// Sem cache
	try {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setTitle('⚠️ Não foi possível verificar')
					.setDescription(
						'O `bot.ts` não respondeu em 12s.\n\n' +
							'**Render:** Cloudflare bloqueia WebSocket — sem solução por código.\n' +
							'**Local/VPS:** verifique o token.'
					)
					.setColor(COLORS.ERROR)
					.setTimestamp(),
			],
		});
	} catch (e) {
		console.error('editReply erro falhou:', e);
	}
}

// ============================================================
// HANDLE AUTO-QUEST
// ============================================================
async function handleAutoQuest(interaction: any, user: any, mode: Mode) {
	const acc = getAccount(user.id);
	if (!acc) {
		try {
			await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
		} catch (e) {
			console.error('reply login falhou:', e);
		}
		return;
	}
	if (runningUsers.has(user.id)) {
		try {
			await interaction.reply({ content: '⏳ Você já tem uma execução em andamento.', ephemeral: true });
		} catch (e) {
			console.error('reply running falhou:', e);
		}
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

	try {
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
	} catch (e) {
		console.error('reply autoquest falhou:', e);
		runningUsers.delete(user.id);
		return;
	}

	let completedCount = 0;
	let failedCount = 0;
	let totalCount = 0;
	let anyLog = false;
	let connectError = false;

	// ✅ Se em 30s nenhum log chegou, avisa
	const noLogTimer = setTimeout(async () => {
		if (anyLog) return;
		try {
			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setTitle('⚠️ Bot não respondeu em 30s')
						.setDescription(
							'O `bot.ts` não conseguiu conectar ao Discord em 30s.\n\n' +
								'**Causa mais comum:** Render bloqueia WebSocket (Cloudflare).\n' +
								'**Solução:** rodar localmente ou em VPS Oracle Free.'
						)
						.setColor(COLORS.WARNING)
						.setTimestamp(),
				],
			});
		} catch (e) {
			console.error('send noLog falhou:', e);
		}
	}, 30 * 1000);

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

				const foundMatch = line.match(/Found (\d+) valid quests/);
				if (foundMatch) {
					totalCount = parseInt(foundMatch[1], 10);
					await channel.send(`🔍 Detectei **${totalCount}** quest(s). Iniciando...`);
				}

				const startMatch = line.match(/\[\d+\/\d+\]\s*Starting:\s*"(.+?)"/);
				if (startMatch) {
					await channel.send(`🚀 Iniciando: **${startMatch[1]}**`);
				}

				const doneMatch = line.match(/Completed:\s*"(.+?)"/);
				if (doneMatch) {
					completedCount++;
					await channel.send({
						embeds: [
							new EmbedBuilder()
								.setAuthor({ name: 'Auto Quest • Concluída', iconURL: LOGO_URL })
								.setTitle(`✅ ${doneMatch[1]}`)
								.setDescription(`Progresso: **${completedCount}** concluída(s)`)
								.setColor(COLORS.SUCCESS)
								.setTimestamp(),
						],
					});
				}

				const failMatch = line.match(/Failed:\s*"(.+?)"\s*[—\-:]\s*(.+)/);
				if (failMatch) {
					failedCount++;
					await channel.send(
						`❌ **Falhou:** ${failMatch[1]}\n**Erro:** \`${failMatch[2].slice(0, 150)}\``
					);
				}

				const claimMatch = line.match(/Claimed:\s*"(.+?)"/);
				if (claimMatch) {
					await channel.send(`🎁 **Recompensa resgatada:** ${claimMatch[1]}`);
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

			try {
				if (connectError && totalCount === 0) {
					await channel.send({
						embeds: [
							new EmbedBuilder()
								.setTitle('❌ Não foi possível conectar')
								.setDescription(
									'O bot não conseguiu conectar ao gateway do Discord.\n\n' +
										'**Render bloqueia WebSocket.** Rode localmente ou em VPS Oracle Free.'
								)
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
									`**Total detectado:** ${totalCount}\n` +
									`**Duração:** ${duration} min`
							)
							.setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
							.setTimestamp(),
					],
				});
			} catch (e) {
				console.error('send resultado falhou:', e);
			}
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
		// ---------- SLASH ----------
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
					ephemeral: true,
				});
				return;
			}

			if (commandName === 'deltoken') {
				removeAccount(user.id);
				await interaction.reply({ content: '🗑️ Token removido.', ephemeral: true });
				return;
			}
		}

		// ---------- BUTTONS ----------
		if (interaction.isButton()) {
			const { customId, user } = interaction;

			if (customId === 'login') {
				await interaction.showModal(addTokenModal());
				return;
			}

			if (customId === 'autoquest') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
					return;
				}
				await interaction.showModal(modeSelectModal());
				return;
			}

			if (customId === 'profile') {
				await handleProfile(interaction, user);
				return;
			}
		}

		// ---------- MODAL SUBMITS ----------
		if (interaction.isModalSubmit()) {
			if (interaction.customId === 'modal_add_token') {
				const tk = interaction.fields.getTextInputValue('input_token').trim();
				await handleLogin(interaction, interaction.user, tk);
				return;
			}

			if (interaction.customId === 'modal_mode') {
				const value = interaction.fields.getStringSelectValues('mode_picker')[0] as Mode;
				await handleAutoQuest(interaction, interaction.user, value);
				return;
			}
		}
	} catch (err: any) {
		console.error('❌ interactionCreate error:', err?.message ?? err);
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: '❌ Erro interno. Veja o console.',
					ephemeral: true,
				});
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));