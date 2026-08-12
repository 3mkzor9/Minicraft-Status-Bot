// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, Collection } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const { status, statusBedrock, query } = require('minecraft-server-util');
const { Rcon } = require('rcon-client');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID; // bot application id
const GUILD_ID = process.env.GUILD_ID || null; // optional for guild-scoped commands during dev
const DEFAULT_HOST = process.env.SERVER_HOST;
const DEFAULT_PORT = parseInt(process.env.SERVER_PORT || '25565', 10);
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || null;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_SECONDS || '60', 10) * 1000;

// helper to parse host[:port]
function parseHost(input) {
  if (!input) return { host: DEFAULT_HOST, port: DEFAULT_PORT };
  if (input.includes(':')) {
    const [h, p] = input.split(':', 2);
    return { host: h, port: parseInt(p, 10) || DEFAULT_PORT };
  }
  return { host: input, port: DEFAULT_PORT };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.commands = new Collection();

// register simple command metadata for REST registration
const commands = [
  {
    name: 'status',
    description: 'Get Minecraft server status',
    options: [
      { name: 'host', type: 3, description: 'host or host:port (overrides default)', required: false }
    ]
  },
  {
    name: 'rcon',
    description: 'Send an RCON command (optional, requires RCON config)',
    options: [
      { name: 'cmd', type: 3, description: 'command to run', required: true },
      { name: 'host', type: 3, description: 'host or host:port (optional)', required: false }
    ]
  }
];

async function registerCommands() {
  if (!CLIENT_ID || !BOT_TOKEN) {
    console.warn('CLIENT_ID or BOT_TOKEN missing; skipping slash command registration.');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log('Registered guild commands.');
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('Registered global commands (may take up to 1 hour to appear).');
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

function makeEmbed(result, host, port, edition = 'Java') {
  const embed = new EmbedBuilder()
    .setTitle(`${host}:${port} — Online (${edition})`)
    .addFields(
      { name: 'Version', value: result.version?.name || 'unknown', inline: true },
      { name: 'Players', value: `${result.players?.online ?? '?'} / ${result.players?.max ?? '?'}`, inline: true }
    )
    .setColor('Green')
    .setTimestamp();

  if (result.motd?.clean) embed.setDescription(result.motd.clean);
  if (result.players?.sample && result.players.sample.length) {
    embed.addFields({ name: 'Players (sample)', value: result.players.sample.map(p => p.name).join(', ') });
  }
  return embed;
}

async function fetchStatus(host, port, timeout = 5000) {
  // Try Java status first
  try {
    const res = await status(host, port, { timeout, enableSRV: true });
    return { ok: true, edition: 'Java', result: res };
  } catch (eJava) {
    // Try Bedrock (library provides statusBedrock)
    try {
      const res = await statusBedrock(host, port, { timeout });
      return { ok: true, edition: 'Bedrock', result: res };
    } catch (eBedrock) {
      return { ok: false, error: eBedrock || eJava };
    }
  }
}

async function tryQuery(host, port, timeout = 5000) {
  try {
    const res = await query(host, port, { timeout });
    return { ok: true, result: res };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function handleStatusCommandInteraction(interaction, hostArg) {
  await interaction.deferReply();
  const { host, port } = parseHost(hostArg);
  const s = await fetchStatus(host, port);
  if (!s.ok) {
    await interaction.editReply(`Server appears offline or timed out: ${s.error?.message ?? s.error}`);
    return;
  }
  const embed = makeEmbed(s.result, host, port, s.edition);
  // attempt a query (only works if Query protocol enabled)
  const q = await tryQuery(host, port);
  if (q.ok) {
    embed.addFields({ name: 'Query (raw)', value: `Plugins: ${q.result.software || '—'}` });
  }
  await interaction.editReply({ embeds: [embed] });
}

async function runRcon(hostArg, command) {
  const hostParsed = parseHost(hostArg);
  const rconHost = process.env.RCON_HOST || hostParsed.host;
  const rconPort = parseInt(process.env.RCON_PORT || hostParsed.port || '25575', 10);
  const rconPass = process.env.RCON_PASSWORD;
  if (!rconPass) throw new Error('RCON_PASSWORD not set in environment');
  const rcon = await Rcon.connect({ host: rconHost, port: rconPort, password: rconPass });
  try {
    const resp = await rcon.send(command);
    await rcon.end();
    return resp;
  } catch (err) {
    await rcon.end().catch(() => {});
    throw err;
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  // start periodic polling if channel configured
  if (STATUS_CHANNEL_ID && DEFAULT_HOST) {
    let lastUp = null;
    setInterval(async () => {
      try {
        const ch = await client.channels.fetch(STATUS_CHANNEL_ID).catch(() => null);
        if (!ch || !ch.isText()) return;
        const { host, port } = parseHost();
        const s = await fetchStatus(host, port);
        if (!s.ok) {
          if (lastUp !== false) {
            await ch.send(`⚠️ Server ${host}:${port} appears DOWN.`);
            lastUp = false;
          }
          return;
        }
        // server is up
        if (lastUp !== true) {
          await ch.send({ embeds: [makeEmbed(s.result, host, port, s.edition).setTitle(`${host}:${port} — Server is UP`)] });
          lastUp = true;
        } else {
          // periodic update (replace with a single message if desired)
          await ch.send({ embeds: [makeEmbed(s.result, host, port, s.edition)] });
        }
      } catch (err) {
        console.error('Periodic poll error:', err);
      }
    }, POLL_INTERVAL);
    console.log('Started periodic polling for server status.');
  }
});

// interaction handler (slash commands)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;
  if (name === 'status') {
    const host = interaction.options.getString('host');
    return handleStatusCommandInteraction(interaction, host);
  } else if (name === 'rcon') {
    const cmd = interaction.options.getString('cmd', true);
    const host = interaction.options.getString('host');
    await interaction.deferReply();
    try {
      const resp = await runRcon(host, cmd);
      await interaction.editReply(`RCON response: ${String(resp).slice(0, 1900)}`);
    } catch (err) {
      await interaction.editReply(`RCON error: ${err.message ?? err}`);
    }
  }
});

// prefix command fallback
const PREFIX = process.env.BOT_PREFIX || '!';
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  if (cmd === 'status') {
    const hostArg = args[0];
    const sent = await message.reply('Fetching server status…');
    const { host, port } = parseHost(hostArg);
    const s = await fetchStatus(host, port);
    if (!s.ok) return sent.edit(`Server offline or timed out: ${s.error?.message ?? s.error}`);
    const embed = makeEmbed(s.result, host, port, s.edition);
    await sent.edit({ content: null, embeds: [embed] });
  } else if (cmd === 'rcon') {
    if (!args.length) return message.reply('Usage: !rcon <command> [host:port]');
    const maybeHost = args[args.length - 1].includes(':') ? args.pop() : null;
    const command = args.join(' ');
    const reply = await message.reply('Sending RCON command…');
    try {
      const resp = await runRcon(maybeHost, command);
      await reply.edit(`RCON response:\n${String(resp).slice(0, 1900)}`);
    } catch (err) {
      await reply.edit(`RCON error: ${err.message ?? err}`);
    }
  }
});

client.login(BOT_TOKEN).catch(err => console.error('Login failed:', err));
