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
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GUILD_ID = '1504422135303634994';
const EMOJI_ID = '1555258800301154374';
const EMOJI_NAME = '653548lightning';
const EMOJI_MENTION = `<a:${EMOJI_NAME}:${EMOJI_ID}>`;

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
// STORAGE
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
// CHILD PROCESS RUNNERS
// ============================================================
interface QuestInfo {
	id: string;
	name: string;
	game: string;
	publisher: string;
	expires_at: string;
	hero: string | null;
	tasks: string[];
}
interface ListResult {
	user: {
		id: string;
		username: string;
		global_name: string | null;
	};
	quests: QuestInfo[];
}

function runListQuests(token: string): Promise<ListResult> {
	return new Promise((resolve, reject) => {
		const child = exec('npx tsx list-quests.ts', {
			cwd: __dirname,
			maxBuffer: 1024 * 1024 * 10,
			env: { ...process.env, TOKEN: token, GITHUB_ACTIONS: 'false' },
		});
		let out = '';
		let err = '';
		child.stdout?.on('data', (d) => {
			out += d;
		});
		child.stderr?.on('data', (d) => {
			err += d;
		});
		child.on('close', () => {
			const m = out.match(/__QUESTS_JSON_START__\n(.+?)\n__QUESTS_JSON_END__/s);
			if (!m) {
				return reject(
					new Error(
						'Falha ao listar quests.\n\nLog:\n' +
							out.slice(-400) +
							'\n\nErros:\n' +
							err.slice(-400)
					)
				);
			}
			try {
				resolve(JSON.parse(m[1]) as ListResult);
			} catch (e) {
				reject(e);
			}
		});
	});
}

function runQuests(token: string, questName?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const env: NodeJS.ProcessEnv = { ...process.env, TOKEN: token };
		if (questName) env.QUEST_NAME = questName;

		const child = exec('npx tsx bot.ts', {
			cwd: __dirname,
			maxBuffer: 1024 * 1024 * 10,
			env,
		});
		let out = '';
		let err = '';
		child.stdout?.on('data', (d) => {
			out += d;
			console.log(d);
		});
		child.stderr?.on('data', (d) => {
			err += d;
			console.error(d);
		});
		child.on('close', (code) => {
			if (code === 0) resolve(out || 'Quest concluída');
			else reject(new Error('Falhou (code ' + code + '):\n' + err.slice(-800)));
		});
	});
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
				`${EMOJI_MENTION} **Login** — Cole o token da sua conta Discord.\n` +
				`${EMOJI_MENTION} **Auto-Quest** — Veja suas quests disponíveis e escolha qual executar.\n` +
				`${EMOJI_MENTION} **Perfil** — Veja os dados da sua conta.`
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
			.setEmoji({ id: EMOJI_ID, name: EMOJI_NAME, animated: true })
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('list_quests')
			.setLabel('Auto-Quest')
			.setEmoji({ id: EMOJI_ID, name: EMOJI_NAME, animated: true })
			.setStyle(ButtonStyle.Primary)
	);
	const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId('profile')
			.setLabel('Perfil')
			.setEmoji({ id: EMOJI_ID, name: EMOJI_NAME, animated: true })
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('help')
			.setLabel('Ajuda')
			.setEmoji('📖')
			.setStyle(ButtonStyle.Secondary)
	);
	return [row1, row2];
}

function profileEmbed(data: ListResult): EmbedBuilder {
	const { user, quests } = data;
	const display = user.global_name ?? user.username;

	return new EmbedBuilder()
		.setAuthor({ name: 'Perfil • Auto Quest', iconURL: LOGO_URL })
		.setTitle('Conta')
		.setDescription(
			`**${display}** (\`${user.username}\`)\n` +
				`**ID:** \`${user.id}\`\n\n` +
				`${EMOJI_MENTION} **Quests disponíveis:** \`${quests.length}\``
		)
		.setColor(COLORS.PURPLE)
		.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
		.setTimestamp();
}

function questsListEmbed(quests: QuestInfo[]): EmbedBuilder {
	const list = quests.length
		? quests
				.slice(0, 10)
				.map(
					(q, i) =>
						`**${i + 1}.** ${q.name}\n> 🎮 ${q.game}\n> 🕒 Expira <t:${Math.floor(
							new Date(q.expires_at).getTime() / 1000
						)}:R>`
				)
				.join('\n\n') + (quests.length > 10 ? `\n\n_...e mais ${quests.length - 10}_` : '')
		: '_Nenhuma quest disponível agora._';

	return new EmbedBuilder()
		.setAuthor({ name: 'Auto Quest • Quests', iconURL: LOGO_URL })
		.setTitle(`${quests.length} quest(s) disponíveis`)
		.setDescription(list)
		.setColor(COLORS.PURPLE)
		.setFooter({ text: 'Clique abaixo para abrir o seletor', iconURL: LOGO_URL });
}

// ============================================================
// MODAL: SELETOR DE QUEST
// ============================================================
function questSelectModal(quests: QuestInfo[]): ModalBuilder {
	const modal = new ModalBuilder()
		.setCustomId('modal_quest_select')
		.setTitle('Escolher quest para executar');

	const options = quests.slice(0, 25).map((q) =>
		new StringSelectMenuOptionBuilder()
			.setLabel(q.name.slice(0, 100))
			.setValue('run_' + q.id)
			.setDescription(`${q.game} — ${q.publisher}`.slice(0, 100))
	);

	const select = new StringSelectMenuBuilder()
		.setCustomId('quest_picker')
		.setPlaceholder('Selecione uma quest...')
		.setMinValues(1)
		.setMaxValues(1)
		.addOptions(options);

	modal.addComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
	return modal;
}

// ============================================================
// READY
// ============================================================
client.once('ready', async () => {
	console.log(`✅ ${client.user?.tag} online`);

	// Verifica emoji
	try {
		const e = await client.emojis.fetch(EMOJI_ID);
		console.log(`✅ Emoji OK: ${e.name} em ${e.guild?.name ?? 'desconhecido'}`);
	} catch {
		console.warn(`⚠️ Emoji ${EMOJI_ID} não acessível. O bot precisa estar no servidor que contém este emoji.`);
	}

	const commands = [
		new SlashCommandBuilder().setName('painel').setDescription('Enviar o painel Auto Quest'),
		new SlashCommandBuilder()
			.setName('token')
			.setDescription('Salvar seu token')
			.addStringOption((o) => o.setName('token').setDescription('Token').setRequired(true)),
		new SlashCommandBuilder().setName('perfil').setDescription('Ver seu perfil e quests'),
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
				await interaction.reply({ content: '✅ Token salvo!', ephemeral: true });
				return;
			}

			if (commandName === 'deltoken') {
				deleteToken(user.id);
				await interaction.reply({ content: '🗑️ Token deletado.', ephemeral: true });
				return;
			}

			if (commandName === 'perfil') {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
					return;
				}
				await interaction.deferReply({ ephemeral: true });
				try {
					const data = await runListQuests(tk);
					await interaction.editReply({ embeds: [profileEmbed(data)] });
				} catch (e: any) {
					await interaction.editReply({ content: '❌ ' + e.message.slice(0, 800) });
				}
				return;
			}
		}

		// ---------- BUTTONS ----------
		if (interaction.isButton()) {
			const { customId, user } = interaction;

			// 🔧 CORRIGIDO: deferReply primeiro para evitar "InteractionAlreadyReplied"
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

			if (customId === 'profile') {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
					return;
				}
				await interaction.deferReply({ ephemeral: true });
				try {
					const data = await runListQuests(tk);
					await interaction.editReply({ embeds: [profileEmbed(data)] });
				} catch (e: any) {
					await interaction.editReply({ content: '❌ ' + e.message.slice(0, 800) });
				}
				return;
			}

			// 🔧 CORRIGIDO: bug do "Faça login primeiro" — agora abre modal direto e valida dentro
			if (customId === 'list_quests') {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						ephemeral: true,
					});
					return;
				}
				await interaction.deferReply({ ephemeral: true });
				try {
					const data = await runListQuests(tk);
					if (data.quests.length === 0) {
						await interaction.editReply({ content: '❌ Nenhuma quest disponível.' });
						return;
					}
					const openBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId('open_quest_modal')
							.setLabel('Escolher Quest')
							.setEmoji('📜')
							.setStyle(ButtonStyle.Primary),
						new ButtonBuilder()
							.setCustomId('run_ALL')
							.setLabel('Executar Todas')
							.setEmoji('⚡')
							.setStyle(ButtonStyle.Success)
					);
					await interaction.editReply({
						embeds: [profileEmbed(data), questsListEmbed(data.quests)],
						components: [openBtn],
					});
				} catch (e: any) {
					await interaction.editReply({ content: '❌ ' + e.message.slice(0, 800) });
				}
				return;
			}

			// 🔧 CORRIGIDO: não checa token antes — abre o modal, validação dentro do modal submit
			if (customId === 'open_quest_modal') {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({
						content: '❌ Faça login primeiro.',
						ephemeral: true,
					});
					return;
				}
				try {
					const data = await runListQuests(tk);
					if (data.quests.length === 0) {
						await interaction.reply({
							content: '❌ Nenhuma quest disponível.',
							ephemeral: true,
						});
						return;
					}
					await interaction.showModal(questSelectModal(data.quests));
				} catch (e: any) {
					await interaction.reply({
						content: '❌ ' + e.message.slice(0, 500),
						ephemeral: true,
					});
				}
				return;
			}

			if (customId.startsWith('run_')) {
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
					return;
				}
				if (isRunning) {
					await interaction.reply({ content: '⏳ Já em execução.', ephemeral: true });
					return;
				}
				const questId = customId.slice(4);
				isRunning = true;
				await interaction.deferReply({ ephemeral: true });

				try {
					const data = await runListQuests(tk);
					const quest = questId === 'ALL' ? null : data.quests.find((q) => q.id === questId);
					if (questId !== 'ALL' && !quest) {
						await interaction.editReply({ content: '❌ Quest não encontrada.' });
						isRunning = false;
						return;
					}
					const nameToRun = questId === 'ALL' ? undefined : quest!.name;
					const label = nameToRun ? `**${nameToRun}**` : '**TODAS as quests**';

					// Envia embed com capa da quest se for uma só
					if (quest && quest.hero) {
						const heroUrl = `https://cdn.discordapp.com/${quest.hero}`;
						const startEmbed = new EmbedBuilder()
							.setAuthor({ name: 'Auto Quest • Iniciando', iconURL: LOGO_URL })
							.setTitle(quest.name)
							.setDescription(`🎮 **${quest.game}**\n🏢 ${quest.publisher}`)
							.setImage(heroUrl)
							.setColor(COLORS.PURPLE)
							.setFooter({ text: 'Vou te avisar por DM quando terminar', iconURL: LOGO_URL });
						await interaction.editReply({
							content: `🚀 Executando ${label}...`,
							embeds: [startEmbed],
						});
					} else {
						await interaction.editReply({
							content: `🚀 Executando ${label}...\n\nVou te avisar por DM quando terminar.`,
						});
					}

					const out = await runQuests(tk, nameToRun);
					await interaction.followUp({
						content: '✅ Finalizado!\n```\n' + out.slice(-1800) + '\n```',
						ephemeral: true,
					});
				} catch (e: any) {
					await interaction.followUp({
						content: '❌ Erro:\n```\n' + String(e.message).slice(-1800) + '\n```',
						ephemeral: true,
					});
				} finally {
					isRunning = false;
				}
				return;
			}

			if (customId === 'help') {
				await interaction.reply({
					content:
						'**Como usar:**\n1. Clique em **Login** e cole o token\n2. Clique em **Auto-Quest**\n3. Clique em **Escolher Quest** e selecione uma no dropdown\n4. Aguarde — o bot faz login real e executa',
					ephemeral: true,
				});
				return;
			}
		}

		// ---------- SELECT MENU ----------
		if (interaction.isStringSelectMenu()) {
			if (interaction.customId === 'quest_picker') {
				const user = interaction.user;
				const tk = getUserToken(user.id);
				if (!tk) {
					await interaction.reply({ content: '❌ Faça login primeiro.', ephemeral: true });
					return;
				}
				if (isRunning) {
					await interaction.reply({ content: '⏳ Já em execução.', ephemeral: true });
					return;
				}
				const questId = interaction.values[0].replace(/^run_/, '');
				isRunning = true;
				await interaction.deferReply({ ephemeral: true });
				try {
					const data = await runListQuests(tk);
					const quest = data.quests.find((q) => q.id === questId);
					if (!quest) {
						await interaction.editReply({ content: '❌ Quest não encontrada.' });
						isRunning = false;
						return;
					}

					// Embed com capa
					if (quest.hero) {
						const heroUrl = `https://cdn.discordapp.com/${quest.hero}`;
						const startEmbed = new EmbedBuilder()
							.setAuthor({ name: 'Auto Quest • Iniciando', iconURL: LOGO_URL })
							.setTitle(quest.name)
							.setDescription(`🎮 **${quest.game}**\n🏢 ${quest.publisher}`)
							.setImage(heroUrl)
							.setColor(COLORS.PURPLE)
							.setFooter({ text: 'Vou te avisar por DM quando terminar', iconURL: LOGO_URL });
						await interaction.editReply({
							content: `🚀 Executando **${quest.name}**...`,
							embeds: [startEmbed],
						});
					} else {
						await interaction.editReply({
							content: `🚀 Executando **${quest.name}**...\n\nAvisarei por DM quando terminar.`,
						});
					}

					const out = await runQuests(tk, quest.name);
					await interaction.followUp({
						content: '✅ Finalizado!\n```\n' + out.slice(-1800) + '\n```',
						ephemeral: true,
					});
				} catch (e: any) {
					await interaction.followUp({
						content: '❌ Erro:\n```\n' + String(e.message).slice(-1800) + '\n```',
						ephemeral: true,
					});
				} finally {
					isRunning = false;
				}
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
					content: '✅ Token salvo! Clique em **Auto-Quest** para ver suas quests.',
					ephemeral: true,
				});
				return;
			}
		}
	} catch (err) {
		console.error('interactionCreate error:', err);
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('Login:', e));