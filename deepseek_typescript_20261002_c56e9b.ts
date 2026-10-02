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
// STORAGE — MULTI-CONTAS (sem label)
// ============================================================
interface Account {
	token: string;
	username?: string;
	id?: string;
}

type TokensStore = Record<string, Account[]>;

const TOKEN_FILE = path.join(__dirname, 'user-tokens.json');

function loadTokens(): TokensStore {
	try {
		if (fs.existsSync(TOKEN_FILE)) {
			const raw = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
			const migrated: TokensStore = {};
			for (const [userId, value] of Object.entries(raw)) {
				if (typeof value === 'string') {
					migrated[userId] = [{ token: value }];
				} else if (Array.isArray(value)) {
					migrated[userId] = (value as any[]).map((a) => ({
						token: a.token,
						username: a.username,
						id: a.id,
					}));
				}
			}
			return migrated;
		}
	} catch (e) {
		console.error('Erro lendo tokens:', e);
	}
	return {};
}

function saveTokens(store: TokensStore) {
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
}

function getUserAccounts(discordId: string): Account[] {
	return loadTokens()[discordId] ?? [];
}

function getAccountByIndex(discordId: string, index: number): Account | null {
	return getUserAccounts(discordId)[index] ?? null;
}

function addAccount(discordId: string, token: string): number {
	const store = loadTokens();
	if (!store[discordId]) store[discordId] = [];
	store[discordId].push({ token });
	saveTokens(store);
	return store[discordId].length - 1;
}

function updateAccount(discordId: string, index: number, patch: Partial<Account>) {
	const store = loadTokens();
	if (!store[discordId] || !store[discordId][index]) return;
	store[discordId][index] = { ...store[discordId][index], ...patch };
	saveTokens(store);
}

function removeAccount(discordId: string, index: number) {
	const store = loadTokens();
	if (!store[discordId]) return;
	store[discordId].splice(index, 1);
	if (store[discordId].length === 0) delete store[discordId];
	saveTokens(store);
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

let isRunning = false;
const pendingAccountChoice = new Map<string, number>();

const COLORS = {
	PURPLE: 0x8b5cf6,
	SUCCESS: 0x2ecc71,
	ERROR: 0xe74c3c,
	WARNING: 0xf1c40f,
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
				`${EMOJI} **Login** — Adicione contas (suporta múltiplas).\n` +
				`${EMOJI} **Auto-Quest** — Detecta e executa TODAS as quests.\n` +
				`${EMOJI} **Perfil** — Veja e gerencie suas contas.\n` +
				`${EMOJI} **Contas** — Lista, remove ou troca de conta.`
		)
		.setColor(COLORS.PURPLE)
		.setImage(BANNER_URL)
		.setFooter({ text: 'Auto Quest • Sistema Automatico', iconURL: LOGO_URL })
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
		new ButtonBuilder().setCustomId('profile').setLabel('Perfil').setEmoji(EMOJI).setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('accounts').setLabel('Contas').setEmoji('💼').setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId('help').setLabel('Ajuda').setEmoji('📖').setStyle(ButtonStyle.Secondary)
	);
	return [row1, row2];
}

// Modal: apenas token (sem label)
function addAccountModal(): ModalBuilder {
	const modal = new ModalBuilder().setCustomId('modal_add_account').setTitle('Adicionar conta');
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

function accountSelectModal(accounts: Account[]): ModalBuilder {
	const modal = new ModalBuilder().setCustomId('modal_pick_account').setTitle('Escolher conta');
	const select = new StringSelectMenuBuilder()
		.setCustomId('account_picker')
		.setPlaceholder('Selecione uma conta...')
		.setMinValues(1)
		.setMaxValues(1);

	accounts.forEach((acc, i) => {
		const label = acc.username ? `Conta ${i + 1} — @${acc.username}` : `Conta ${i + 1}`;
		const desc = acc.id ? `ID: ${acc.id}` : 'ID: desconhecido';
		select.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel(label.slice(0, 100))
				.setDescription(desc.slice(0, 100))
				.setValue(String(i))
				.setEmoji(EMOJI)
		);
	});

	modal.addComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select));
	return modal;
}

function accountsManageModal(accounts: Account[]): ModalBuilder {
	const modal = new ModalBuilder().setCustomId('modal_manage_accounts').setTitle('Remover conta');
	const select = new StringSelectMenuBuilder()
		.setCustomId('manage_picker')
		.setPlaceholder('Selecione a conta para remover...')
		.setMinValues(1)
		.setMaxValues(1);

	accounts.forEach((acc, i) => {
		const label = acc.username ? `🗑️ Conta ${i + 1} — @${acc.username}` : `🗑️ Conta ${i + 1}`;
		const desc = acc.id ? `ID: ${acc.id}` : 'ID: desconhecido';
		select.addOptions(
			new StringSelectMenuOptionBuilder()
				.setLabel(label.slice(0, 100))
				.setDescription(desc.slice(0, 100))
				.setValue(String(i))
		);
	});

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
			.setDescription('Adicionar uma conta')
			.addStringOption((o) => o.setName('token').setDescription('Token da conta').setRequired(true)),
		new SlashCommandBuilder().setName('contas').setDescription('Ver e gerenciar suas contas'),
		new SlashCommandBuilder().setName('deltoken').setDescription('Remover todas as contas'),
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
// VERIFICAR CONTA (timeout maior — 90s)
// ============================================================
async function verifyAccount(token: string): Promise<{
	id: string;
	username: string;
	global_name: string | null;
	avatar: string | null;
	quests: number;
} | null> {
	return new Promise((resolve) => {
		let profileJson: string | null = null;
		let finished = false;

		const finish = (val: any) => {
			if (finished) return;
			finished = true;
			resolve(val);
		};

		const child = runBot(
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

		// ✅ Timeout maior: 90s
		setTimeout(() => {
			try {
				child.kill('SIGTERM');
			} catch {
				/* ignore */
			}
			if (!profileJson) finish(null);
		}, 90 * 1000);
	});
}

// ============================================================
// HANDLERS
// ============================================================
async function handleProfile(interaction: any, user: any) {
	const accounts = getUserAccounts(user.id);
	if (accounts.length === 0) {
		await interaction.reply({ content: '❌ Nenhuma conta registrada.', ephemeral: true });
		return;
	}
	await interaction.deferReply({ ephemeral: true });

	const lines: string[] = [];
	for (let i = 0; i < accounts.length; i++) {
		const acc = accounts[i];
		const info = await verifyAccount(acc.token);
		if (info) {
			updateAccount(user.id, i, { username: info.username, id: info.id });
			lines.push(
				`**Conta ${i + 1}** — @${info.username}\n> ID: \`${info.id}\` • Quests: **${info.quests}**`
			);
		} else {
			lines.push(`**Conta ${i + 1}** — ⚠️ Não foi possível verificar (offline)`);
		}
	}

	await interaction.editReply({
		embeds: [
			new EmbedBuilder()
				.setAuthor({ name: 'Perfil • Auto Quest', iconURL: LOGO_URL })
				.setTitle(`💼 Suas contas (${accounts.length})`)
				.setDescription(lines.join('\n\n').slice(0, 4000))
				.setColor(COLORS.PURPLE)
				.setFooter({ text: 'Auto Quest • Perfil', iconURL: LOGO_URL })
				.setTimestamp(),
		],
	});
}

async function handleAutoQuest(interaction: any, user: any, mode: Mode, accountIndex: number) {
	const accounts = getUserAccounts(user.id);
	const acc = accounts[accountIndex];
	if (!acc) {
		await interaction.reply({ content: '❌ Conta não encontrada.', ephemeral: true });
		return;
	}
	if (isRunning) {
		await interaction.reply({ content: '⏳ Já em execução.', ephemeral: true });
		return;
	}

	isRunning = true;
	const startTime = Date.now();

	const modeLabel =
		mode === 'sequential_delay'
			? '🐢 1 por 1 (delay 3 min)'
			: mode === 'all_parallel'
			? '⚡ Paralelo'
			: '⏱️ Série com delay';

	const channel = interaction.channel;
	const accountLabel = acc.username ? `@${acc.username}` : `Conta ${accountIndex + 1}`;

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
				.setFooter({ text: 'Auto Quest', iconURL: LOGO_URL }),
		],
	});

	let completedCount = 0;
	let failedCount = 0;
	let totalCount = 0;

	const child = runBot(
		acc.token,
		mode,
		async (line) => {
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
								`Conta: **${accountLabel}**\n` +
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
		},
		async (code, output, error) => {
			isRunning = false;
			const duration = ((Date.now() - startTime) / 60000).toFixed(1);
			const success = code === 0;

			await channel.send({
				embeds: [
					new EmbedBuilder()
						.setAuthor({ name: `Resultado — ${user.tag}`, iconURL: user.displayAvatarURL() })
						.setTitle(success ? `${EMOJI} Execução Finalizada!` : '❌ Execução com Falhas')
						.setDescription(
							`**Conta:** ${accountLabel}\n` +
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
				await interaction.editReply({ content: '⏳ Verificando token...' });

				const info = await verifyAccount(tk);
				const idx = addAccount(user.id, tk);

				if (info) {
					updateAccount(user.id, idx, { username: info.username, id: info.id });
					await interaction.editReply({
						content:
							`${EMOJI} **Conta ${idx + 1} adicionada!**\n\n` +
							`**Username:** @${info.username}\n` +
							`**ID:** \`${info.id}\`\n` +
							`**Quests disponíveis:** ${info.quests}`,
					});
				} else {
					// ✅ Salva mesmo se a verificação falhar
					await interaction.editReply({
						content:
							`${EMOJI} **Conta ${idx + 1} adicionada** (verificação offline).\n\n` +
							`O token foi salvo. Tente usar **Auto-Quest** — se for válido, vai funcionar.`,
					});
				}
				return;
			}

			if (commandName === 'contas') {
				await handleProfile(interaction, user);
				return;
			}

			if (commandName === 'deltoken') {
				const store = loadTokens();
				delete store[user.id];
				saveTokens(store);
				await interaction.reply({ content: '🗑️ Todas as contas removidas.', ephemeral: true });
				return;
			}
		}

		// ---------- BUTTONS ----------
		if (interaction.isButton()) {
			const { customId, user } = interaction;

			if (customId === 'login') {
				await interaction.showModal(addAccountModal());
				return;
			}

			if (customId === 'autoquest') {
				const accounts = getUserAccounts(user.id);
				if (accounts.length === 0) {
					await interaction.reply({ content: '❌ Nenhuma conta registrada.', ephemeral: true });
					return;
				}
				if (accounts.length === 1) {
					pendingAccountChoice.set(user.id, 0);
					await interaction.showModal(modeSelectModal());
					return;
				}
				await interaction.showModal(accountSelectModal(accounts));
				return;
			}

			if (customId === 'profile') {
				await handleProfile(interaction, user);
				return;
			}

			if (customId === 'accounts') {
				const accounts = getUserAccounts(user.id);
				if (accounts.length === 0) {
					await interaction.reply({ content: '❌ Nenhuma conta registrada.', ephemeral: true });
					return;
				}
				await interaction.showModal(accountsManageModal(accounts));
				return;
			}

			if (customId === 'help') {
				await interaction.reply({
					content:
						`${EMOJI} **Como usar:**\n` +
						'1. **Login** — adicione uma conta (só o token)\n' +
						'2. **Auto-Quest** — escolha a conta e o modo\n' +
						'3. **Perfil** — veja todas as contas registradas\n' +
						'4. **Contas** — remova uma conta específica',
					ephemeral: true,
				});
				return;
			}
		}

		// ---------- MODAL SUBMITS ----------
		if (interaction.isModalSubmit()) {
			// ---- ADICIONAR CONTA (só token) ----
			if (interaction.customId === 'modal_add_account') {
				const tk = interaction.fields.getTextInputValue('input_token').trim();
				if (tk.length < 30 || tk.split('.').length < 3) {
					await interaction.reply({ content: '❌ Token inválido.', ephemeral: true });
					return;
				}

				await interaction.deferReply({ ephemeral: true });
				await interaction.editReply({ content: '⏳ Verificando token...' });

				const info = await verifyAccount(tk);
				const idx = addAccount(interaction.user.id, tk);

				if (info) {
					updateAccount(interaction.user.id, idx, { username: info.username, id: info.id });
					await interaction.editReply({
						content:
							`${EMOJI} **Conta ${idx + 1} adicionada!**\n\n` +
							`**Username:** @${info.username}\n` +
							`**ID:** \`${info.id}\`\n` +
							`**Quests:** ${info.quests}`,
					});
				} else {
					await interaction.editReply({
						content:
							`${EMOJI} **Conta ${idx + 1} adicionada** (verificação offline).\n\n` +
							`O token foi salvo. Tente usar **Auto-Quest** — se for válido, vai funcionar.`,
					});
				}
				return;
			}

			// ---- ESCOLHER MODO ----
			if (interaction.customId === 'modal_mode') {
				const value = interaction.fields.getStringSelectValues('mode_picker')[0] as Mode;
				const key = interaction.user.id;
				const accIdx = pendingAccountChoice.get(key) ?? 0;
				pendingAccountChoice.delete(key);
				await handleAutoQuest(interaction, interaction.user, value, accIdx);
				return;
			}

			// ---- ESCOLHER CONTA ----
			if (interaction.customId === 'modal_pick_account') {
				const value = interaction.fields.getStringSelectValues('account_picker')[0];
				const idx = parseInt(value, 10);
				pendingAccountChoice.set(interaction.user.id, idx);
				await interaction.showModal(modeSelectModal());
				return;
			}

			// ---- REMOVER CONTA ----
			if (interaction.customId === 'modal_manage_accounts') {
				const value = interaction.fields.getStringSelectValues('manage_picker')[0];
				const idx = parseInt(value, 10);
				const acc = getAccountByIndex(interaction.user.id, idx);
				if (!acc) {
					await interaction.reply({ content: '❌ Conta não encontrada.', ephemeral: true });
					return;
				}
				removeAccount(interaction.user.id, idx);
				await interaction.reply({
					content: `🗑️ Conta ${idx + 1} removida.`,
					ephemeral: true,
				});
				return;
			}
		}
	} catch (err) {
		console.error('interactionCreate error:', err);
		try {
			if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
				await interaction.reply({ content: '❌ Erro interno.', ephemeral: true });
			}
		} catch {
			/* ignore */
		}
	}
});

client.login(BOT_TOKEN).catch((e) => console.error('Login:', e));