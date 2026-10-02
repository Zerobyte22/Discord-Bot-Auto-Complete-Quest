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
// FAKE PORT
// ============================================================
const PORT = process.env.PORT || 3000;
http
	.createServer((req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/plain' });
		res.end('Auto Quest online');
	})
	.listen(PORT, () => console.log(`Fake server on port ${PORT}`));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
	console.error('BOT_TOKEN missing!');
	process.exit(1);
}

// ============================================================
// STORAGE (persistente — só apaga com /deltoken)
// ============================================================
const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');

function loadTokens(): Record<string, string> {
	try {
		if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
	} catch (e) {
		console.error('Erro lendo tokens:', e);
	}
	return {};
}
function saveToken(id: string, tk: string) {
	const t = loadTokens();
	t[id] = tk;
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
}
function getUserToken(id: string): string | null {
	return loadTokens()[id] ?? null;
}
function deleteToken(id: string) {
	const t = loadTokens();
	delete t[id];
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
}

// ============================================================
// CHILD PROCESS — roda bot.ts (auto-quest real)
// ============================================================
interface QuestProgress {
	logs: string[];
	onLog: (line: string) => void;
	onDone: (code: number, output: string, error: string) => void;
}

function runQuests(token: string, progress: QuestProgress) {
	const child = spawn('npx', ['tsx', 'bot.ts'], {
		cwd: __dirname,
		env: { ...process.env, TOKEN: token, GITHUB_ACTIONS: 'false' },
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
				progress.onLog(line);
			});
	});

	child.stderr.on('data', (d: Buffer) => {
		const s = d.toString();
		errorOutput += s;
		s.split('\n')
			.filter(Boolean)
			.forEach((line) => {
				console.error(line);
				progress.onLog('⚠️ ' + line);
			});
	});

	child.on('close', (code) => progress.onDone(code ?? 1, fullOutput, errorOutput));
	child.on('error', (err) => progress.onDone(1, fullOutput, err.message));

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

let isRunning = false;

const COLORS = {
	PURPLE: 0x8b5cf6,
	SUCCESS: 0x2ecc71,
	ERROR: 0xe74c3c,
	WARNING: 0xf1c40f,
	DARK: 0x2b2d31,
};
const BANNER_URL = process.env.BANNER_URL || 'https://i.imgur.com/AfFp7pu.png';
const LOGO_URL = process.env.LOGO_URL || 'https://i.imgur.com/AfFp7pu.png';

// ============================================================
// EMBEDS
// ============================================================
function mainPanelEmbed(): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest', iconURL: LOGO_URL })
		.setTitle('Auto Quest')
		.setDescription(
			'**Auto Quest**\n' +
				`${EMOJI} **Login** — Cole o token da sua conta Discord (uma única vez).\n` +
				`${EMOJI} **Auto-Quest** — Detecta e executa TODAS as quests automaticamente.\n` +
				`${EMOJI} **Perfil** — Veja os dados da sua conta.`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Sistema Automatico', iconURL: LOGO_URL })
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
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('help')
			.setLabel('Ajuda')
			.setEmoji('📖')
			.setStyle(ButtonStyle.Secondary)
	);
	return [row1, row2];
}

function startEmbed(avatar: string, userName: string): EmbedBuilder {
	return new EmbedBuilder()
		.setAuthor({ name: `Executando para ${userName}`, iconURL: avatar })
		.setTitle(`${EMOJI} Auto-Quest Iniciado!`)
		.setDescription(
			'**Status:** 🔍 Detectando quests...\n\n' +
				'O bot vai:\n' +
				'• 1️⃣ Detectar todas as quests da sua conta\n' +
				'• 2️⃣ Executar **uma por vez**\n' +
				'• 3️⃣ Aguardar **3 minutos** entre cada\n' +
				'• 4️⃣ Te avisar por DM a cada conclusão'
		)
		.setColor(COLORS.PURPLE)
		.setFooter({ text: 'Você receberá DMs conforme avançar', iconURL: LOGO_URL });
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
			.setDescription('Salvar seu token')
			.addStringOption((o) => o.setName('token').setDescription('Token').setRequired(true)),
		new SlashCommandBuilder().setName('mytoken').setDescription('Ver status do token'),
		new SlashCommandBuilder().setName('deltoken').setDescription('Deletar seu token'),
	].map((c) => c.toJSON());

	const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
	try {
		await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), { body: [] });
		const data = (await rest.put(Routes.applicationGuildCommands(client.user!.id, GUILD_ID), {
			body: commands,
		})) as any[];
		console.log(`✅ ${data.length} comandos registrados`);
	} catch (e: any) {
		console.error('Erro registrando:', e?.message);
	}
});

// ============================================================
// HANDLE AUTO-QUEST
// ============================================================
async function handleAutoQuest(interaction: any, user: any) {
	const token = getUserToken(user.id);

	if (!token) {
		await interaction.reply({
			content: '❌ Faça login primeiro. Clique no botão **Login**.',
			ephemeral: true,
		});
		return;
	}

	if (isRunning) {
		await interaction.reply({
			content: '⏳ Já existe uma execução em andamento. Aguarde terminar.',
			ephemeral: true,
		});
		return;
	}

	isRunning = true;
	const startTime = Date.now();
	const logs: string[] = [];

	const reply = await interaction.reply({
		embeds: [startEmbed(user.displayAvatarURL(), user.tag)],
		ephemeral: false,
		fetchReply: true,
	});

	let lastUpdate = 0;
	const updateInterval = setInterval(async () => {
		try {
			const elapsed = Math.floor((Date.now() - startTime) / 1000);
			// Atualiza a cada 15s (evita rate limit)
			if (Date.now() - lastUpdate < 15000) return;
			lastUpdate = Date.now();

			const recentLogs =
				logs.slice(-5).map((l) => `> ${l.slice(0, 100)}`).join('\n') || '> Aguardando...';

			const embed = new EmbedBuilder()
				.setAuthor({ name: `Executando para ${user.tag}`, iconURL: user.displayAvatarURL() })
				.setTitle(`${EMOJI} Processando Quests...`)
				.setDescription(
					`**Status:** 🟢 Em andamento (${elapsed}s)\n\n**Últimos eventos:**\n${recentLogs}`
				)
				.setColor(COLORS.PURPLE)
				.setFooter({ text: 'Aguarde — você será avisado por DM', iconURL: LOGO_URL });

			await interaction.editReply({ embeds: [embed] });
		} catch {
			/* ignore */
		}
	}, 5000);

	const child = runQuests(token, {
		logs,
		onLog: (line) => {
			logs.push(line.trim());
			if (logs.length > 200) logs.shift();
		},
		onDone: async (code, output, error) => {
			clearInterval(updateInterval);
			isRunning = false;

			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			const finalEmbed = new EmbedBuilder()
				.setAuthor({ name: `Resultado — ${user.tag}`, iconURL: user.displayAvatarURL() })
				.setTitle(success ? `${EMOJI} Execução Finalizada!` : '❌ Execução Falhou!')
				.setDescription(
					success
						? 'Todas as quests foram processadas. Confira sua DM para o resumo completo.'
						: 'Erro durante a execução. Veja o resumo abaixo.'
				)
				.addFields(
					{
						name: '📊 Resumo',
						value: success
							? '```\nVerifique sua DM para detalhes\n```'
							: '```\n' + ((error || output).slice(0, 800) || 'Erro desconhecido') + '\n```',
						inline: false,
					},
					{ name: '⏱️ Duração', value: `${duration} min`, inline: true },
					{ name: '👤 Usuário', value: user.tag, inline: true }
				)
				.setColor(success ? COLORS.SUCCESS : COLORS.ERROR)
				.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL });

			try {
				await interaction.editReply({ embeds: [finalEmbed] });
			} catch {
				try {
					await interaction.followUp({ embeds: [finalEmbed], ephemeral: true });
				} catch {
					/* ignore */
				}
			}
		},
	});

	// Timeout de segurança (30 min)
	setTimeout(() => {
		try {
			child.kill('SIGTERM');
		} catch {
			/* ignore */
		}
	}, 30 * 60 * 1000);
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
				await interaction.reply({
					embeds: [mainPanelEmbed()],
					components: mainPanelButtons(),
				});
				return;
			}

			if (commandName === 'token') {
				const tk = interaction.options.getString('token', true).trim();
				if (tk.length < 30 || tk.split('.').length < 3) {
					await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
					return;
				}
				saveToken(user.id, tk);
				await interaction.reply({
					content: `${EMOJI} Token salvo! Agora clique em **Auto-Quest** no painel.`,
					ephemeral: true,
				});
				return;
			}

			if (commandName === 'mytoken') {
				const has = !!getUserToken(user.id);
				await interaction.reply({
					content: has
						? `${EMOJI} Você tem um token salvo. Ele fica ativo até você usar \`/deltoken\`.`
						: '❌ Nenhum token registrado.',
					ephemeral: true,
				});
				return;
			}

			if (commandName === 'deltoken') {
				deleteToken(user.id);
				await interaction.reply({ content: '🗑️ Token deletado.', ephemeral: true });
				return;
			}
		}

		// ---------- BUTTONS ----------
		if (interaction.isButton()) {
			const { customId, user } = interaction;

			if (customId === 'login') {
				const modal = new ModalBuilder()
					.setCustomId('modal_login')
					.setTitle('Login — token da sua conta');
				modal.addComponents(
					new ActionRowBuilder<TextInputBuilder>().addComponents(
						new TextInputBuilder()
							.setCustomId('input_token')
							.setLabel('Token da conta (nunca compartilhe)')
							.setStyle(TextInputStyle.Paragraph)
							.setMinLength(30)
							.setMaxLength(200)
							.setRequired(true)
					)
				);
				await interaction.showModal(modal);
				return;
			}

			if (customId === 'autoquest') {
				await handleAutoQuest(interaction, user);
				return;
			}

			if (customId === 'profile') {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						ephemeral: true,
					});
					return;
				}
				// Perfil rápido — sem chamar API (evita lentidão)
				await interaction.reply({
					embeds: [
						new EmbedBuilder()
							.setAuthor({ name: 'Perfil • Auto Quest', iconURL: LOGO_URL })
							.setTitle('Conta')
							.setDescription(
								`**${user.tag}**\n` +
									`**ID:** \`${user.id}\`\n\n` +
									`${EMOJI} **Token:** Ativo`
							)
							.setColor(COLORS.PURPLE)
							.setThumbnail(user.displayAvatarURL())
							.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL }),
					],
					ephemeral: true,
				});
				return;
			}

			if (customId === 'help') {
				await interaction.reply({
					content:
						`${EMOJI} **Como usar:**\n` +
						'1. Clique em **Login** e cole o token (só uma vez)\n' +
						'2. Clique em **Auto-Quest** — o bot detecta todas as quests sozinho\n' +
						'3. Aguarde as DMs com o progresso de cada uma\n' +
						'4. Não precisa escolher nada — o bot faz automaticamente',
					ephemeral: true,
				});
				return;
			}
		}

		// ---------- MODAL SUBMIT ----------
		if (interaction.isModalSubmit()) {
			if (interaction.customId === 'modal_login') {
				const tk = interaction.fields.getTextInputValue('input_token').trim();
				if (tk.length < 30 || tk.split('.').length < 3) {
					await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
					return;
				}
				saveToken(interaction.user.id, tk);
				await interaction.reply({
					content: `${EMOJI} Token salvo! Clique em **Auto-Quest** para iniciar.`,
					ephemeral: true,
				});
				return;
			}
		}
	} catch (err) {
		console.error('interactionCreate error:', err);
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({
					content: '❌ Erro interno. Tente novamente.',
					ephemeral: true,
				});
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('Login:', e));
