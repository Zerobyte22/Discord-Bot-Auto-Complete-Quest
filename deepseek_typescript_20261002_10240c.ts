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

const GUILD_ID = '1504422135303634994';
const EMOJI = '👻';

// ============================================================
// BANNER GIF (fornecido pelo usuário)
// ============================================================
const BANNER_URL =
	'https://cdn.discordapp.com/attachments/1552448890656137297/1555453870791069776/0cb8780082d2e46710a73f06c51285bb.gif?backend=b2&ex=6ac094cd&is=6abf434d&hm=8062b124189aa05081c4c6f9758042c2b596a9ad3cdcf897c86e06cae0754455&';
const LOGO_URL = process.env.LOGO_URL || BANNER_URL;

// ============================================================
// FAKE PORT (Render)
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
// STORAGE — 1 CONTA POR USUÁRIO
// ============================================================
interface Account {
	token: string;
	username?: string;
	id?: string;
}

const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');

function loadAll(): Record<string, any> {
	try {
		if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
	} catch (e) {
		console.error('Erro lendo tokens:', e);
	}
	return {};
}

function getAccount(discordId: string): Account | null {
	const store = loadAll();
	const val = store[discordId];
	if (!val) return null;
	if (Array.isArray(val)) return val[0] ?? null;
	if (typeof val === 'string') return { token: val };
	return val as Account;
}

function saveAccount(discordId: string, account: Account) {
	const store = loadAll();
	store[discordId] = account;
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

function removeAccount(discordId: string) {
	const store = loadAll();
	delete store[discordId];
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

// ============================================================
// CHILD PROCESS — roda bot.ts
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
	PURPLE: 0x8b5cf6,       // roxo principal
	PURPLE_DARK: 0x6d28d9,  // roxo escuro
	PURPLE_LIGHT: 0xa78bfa, // roxo claro
	SUCCESS: 0x2ecc71,
	ERROR: 0xe74c3c,
	WARNING: 0xf1c40f,
	DARK: 0x2b2d31,
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
		new ButtonBuilder()
			.setCustomId('login')
			.setLabel('Login')
			.setEmoji(EMOJI)
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('autoquest')
			.setLabel('Auto-Quest')
			.setEmoji(EMOJI)
			.setStyle(ButtonStyle.Primary)
	);
	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('profile')
			.setLabel('Perfil')
			.setEmoji(EMOJI)
			.setStyle(ButtonStyle.Secondary)
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
		console.log(`✅ ${data.length} comandos registrados`);
	} catch (e: any) {
		console.error('❌ Erro registrando:', e?.message);
	}
});

// ============================================================
// VERIFICAR CONTA — timeout 20s
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

		// ✅ Timeout de 20 segundos
		setTimeout(() => {
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
		}, 20 * 1000);
	});
}

// ============================================================
// HANDLERS
// ============================================================
async function handleProfile(interaction: any, user: any) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
		return;
	}

	await interaction.deferReply({ ephemeral: true });

	const info = await verifyAccount(acc.token);
	if (!info) {
		await interaction.editReply({
			embeds: [
				new EmbedBuilder()
					.setAuthor({ name: 'Perfil • Auto Quest', iconURL: LOGO_URL })
					.setTitle(`${EMOJI} Conta conectada`)
					.setDescription(
						'**Token salvo** (verificação pendente)\n\n' +
							'Não foi possível conectar em 20s. Tente novamente em alguns instantes.'
					)
					.setColor(COLORS.WARNING)
					.setThumbnail(BANNER_URL)
					.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
					.setTimestamp(),
			],
		});
		return;
	}

	saveAccount(user.id, { ...acc, username: info.username, id: info.id });

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
				.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
				.setTimestamp(),
		],
	});
}

async function handleAutoQuest(interaction: any, user: any, mode: Mode) {
	const acc = getAccount(user.id);
	if (!acc) {
		await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
		return;
	}
	if (runningUsers.has(user.id)) {
		await interaction.reply({ content: '⏳ Você já tem uma execução em andamento.', ephemeral: true });
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
	const accountLabel = acc.username ? `@${acc.username}` : 'Conta conectada';

	await interaction.reply({
		embeds: [
			new EmbedBuilder()
				.setAuthor({ name: `Executando para ${user.tag}`, iconURL: user.displayAvatarURL() })
				.setTitle(`${EMOJI} Auto-Quest Iniciado!`)
				.setDescription(
					`**Conta:** ${accountLabel}\n` +
						`**Modo:** ${modeLabel}\n\nAcompanhe aqui no canal.`
				)
				.setColor(COLORS.PURPLE)
				.setImage(BANNER_URL)
				.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL })
				.setTimestamp(),
		],
	});

	let completedCount = 0;
	let failedCount = 0;
	let totalCount = 0;

	const child = runBot(
		acc.token,
		mode,
		async (line) => {
			try {
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
			runningUsers.delete(user.id);
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			if (totalCount === 0) {
				await channel.send({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: `Resultado — ${user.tag}`, iconURL: user.displayAvatarURL() })
							.setTitle('❌ Nenhuma quest disponível')
							.setDescription(
								'A conta não tem quests ativas no momento.\n' +
									'Tente novamente mais tarde ou verifique se o token é de uma conta com quests.'
							)
							.setColor(COLORS.WARNING)
							.setTimestamp()
							.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
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
	}, 60 * 60 * 1000);
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
				if (tk.length < 30 || tk.split('.').length < 3) {
					await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
					return;
				}

				await interaction.deferReply({ ephemeral: true });
				await interaction.editReply({ content: '⏳ Verificando token (máx 20s)...' });

				saveAccount(user.id, { token: tk });

				const info = await verifyAccount(tk);
				if (info) {
					saveAccount(user.id, { token: tk, username: info.username, id: info.id });
					await interaction.editReply({
						content:
							`${EMOJI} **Conta conectada!**\n\n` +
							`**Username:** @${info.username}\n` +
							`**ID:** \`${info.id}\`\n` +
							`**Quests disponíveis:** ${info.quests}`,
					});
				} else {
					await interaction.editReply({
						content:
							`${EMOJI} **Token salvo** (verificação pendente).\n\n` +
							`Use **Auto-Quest** para tentar executar.`,
					});
				}
				return;
			}

			if (commandName === 'mytoken') {
				const acc = getAccount(user.id);
				if (!acc) {
					await interaction.reply({ content: '❌ Nenhum token registrado.', ephemeral: true });
					return;
				}
				await interaction.reply({
					content: `${EMOJI} Você tem um token salvo${acc.username ? ` (@${acc.username})` : ''}.`,
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
				if (tk.length < 30 || tk.split('.').length < 3) {
					await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
					return;
				}

				await interaction.deferReply({ ephemeral: true });
				await interaction.editReply({ content: '⏳ Verificando token (máx 20s)...' });

				saveAccount(interaction.user.id, { token: tk });

				const info = await verifyAccount(tk);
				if (info) {
					saveAccount(interaction.user.id, {
						token: tk,
						username: info.username,
						id: info.id,
					});
					await interaction.editReply({
						content:
							`${EMOJI} **Conta conectada!**\n\n` +
							`**Username:** @${info.username}\n` +
							`**ID:** \`${info.id}\`\n` +
							`**Quests:** ${info.quests}`,
					});
				} else {
					await interaction.editReply({
						content:
							`${EMOJI} **Token salvo** (verificação pendente).\n\n` +
							`Use **Auto-Quest** para tentar executar.`,
					});
				}
				return;
			}

			if (interaction.customId === 'modal_mode') {
				const value = interaction.fields.getStringSelectValues('mode_picker')[0] as Mode;
				await handleAutoQuest(interaction, interaction.user, value);
				return;
			}
		}
	} catch (err: any) {
		console.error('❌ interactionCreate error:', err);
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: '❌ Erro interno. Veja o console para detalhes.',
					ephemeral: true,
				});
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('❌ Login:', e));