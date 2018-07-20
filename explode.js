const fs = require('fs');
const path = require('path');
const R = require('ramda');
const moment = require('moment');
const _mkdirp = require('mkdirp');
const request = require('request');
const logUpdate = require('log-update');

// Usage:
//   node ./explode.js <SOURCE_DIRECTORY_OF_UNZIPPED_SLACK_EXPORT> <DESTINATION_DIRECTORY_TO_CREATE_FILES> [OPTIONS]
//     - Will explode all channels and DMs
//     OPTIONS:
//       "channels:all"                                    - Will explode all channels (NOTE: this will override channels:only and channels:except)
//       "channels:only:<channelname>,<channelname>,..."   - Will only explode the provided channels
//       "channels:except:<channelname>,<channelname>,..." - Will explode all channels except the provided channels
//       "dms:all"                                         - Will explode all DMs (NOTE: this will override dms:only and dms:except)
//       "dms:only:<DM_Id>,<DM_Id>,..."                    - Will only explode the provided DMs
//       "dms:except:<DM_Id>,<DM_Id>,..."                  - Will explode all DMs except the provided DMs
//       "download-attachments"                            - Will also download the attachments
//         (NOTE: even when download-attachments is not provided, the links in the resulting HTML will be replaced with links to where the attachment would be downloaded to)
//         TODO: add ability to specify not to overwrite the links

const TIME_FORMAT = "hh:mm A";
const DAY_FORMAT = "dddd, MMMM Do YYYY";
const DAY_ID_FORMAT = "YYYY-MM-DD";
const HTML_META = `<meta charset="utf-8"><meta http-equiv="X-UA-COMPATIBLE" content="IE=edge"><meta name="viewport" content="width=device-width,initial-scale=1.0">`;
const HTML_CSS = `<link href="https://fonts.googleapis.com/css?family=Noto+Serif:400,400i,700" rel="stylesheet"><style>h2{padding-bottom:1rem;margin-bottom:1rem;border-bottom:1px solid #888;display:flex;justify-content:space-between;}.day-link{font-size:125%;color:blueviolet;text-decoration:none;}.day-text{margin-left:1rem;}.log{font-family: 'Noto Serif', serif;margin:0;}.log-main{display:flex;flex-wrap:wrap;}.user-name,.log-time{white-space:nowrap;}.log-time{margin-left:1rem;color:#333;font-style:italic;}.log-text{margin-left:1rem;}.log-reactions{padding:0.5rem;border:2px solid burlywood;}.log-reaction-type{font-weight: bold;}.log-reaction+.log-reaction,.log-reply+.log-reply{border-top:1px solid burlywood;}.log-reply{margin-left:1rem;position:relative;}.log-reply::before{position:absolute;top:0;left:-1rem;content:" ⤷";}.referenced-user{background-color:lightblue;font-weight: bold;}.mention{background-color:yellowgreen;font-weight:bold;}.channel-mention{background-color:yellow;font-weight:bold;}.multiline-code{margin:0;padding:1rem;border:1px solid black;}main{display:flex;flex-direction:column-reverse;}.years{display:flex;flex-direction:column;}.year{border:1px solid beige;padding:1.5rem 1rem 1rem 1rem;position:relative;flex:1 0;}.year-header{display:block;font-weight:bold;font-size:20px;position:absolute;top:0;left:0;line-height:1rem;padding:0.25rem;background-color:beige;}.months{display:flex;flex-wrap:wrap;}.month{flex: 0 0 15%;}@media (min-width: 800px) and (max-width:1099px){.month{flex:1 1 15%;}}@media (min-width:500px) and (max-width:799px){.month{flex:1 1 30%;}}@media (min-width: 350px) and (max-width:499px){.month{flex:1 1 50%;}}@media (max-width:349px){.month{flex:0 0 100%;}}.month-header{display:block;font-size:21px;}.toc-day{width:2rem;display:flex;justify-content:center;background-color:lightslategray;color:aliceblue;padding:0.25rem;}.days{display:flex;flex-wrap:wrap;}.toc-day:hover{background-color:aliceblue;color:lightslategray;}</style>`;
const LOG_FILE_HTML_PREPEND = `<html><head>${HTML_META}${HTML_CSS}</head><body><main>`;
const LOG_FILE_HTML_APPEND = "</main></body></html>";
const LOG_FILE_HTML_CHAT_SECTION_PREPEND = `<div id="chat" class="chat-section">`;
const LOG_FILE_HTML_CHAT_SECTION_APPEND = `</div>`;
const LOG_FILE_HTML_TOC_SECTION_PREPEND = `<div id="toc" class="toc-section">`;
const LOG_FILE_HTML_TOC_SECTION_APPEND = `</div>`;

// The keys in this array are used to check each log as it's processed,
// and log to the console when a log is processed that contains a key not in
// this list.
// TODO: It would be smarter to have a known_log_keys array for each
// subtype, since some keys mean different things on different subtyped logs
// NOTE: I didn't investigate each of these keys very thoroughly, and most are
// simply ignored
const KNOWN_LOG_KEYS = [
  'attachments',
  'bot_id',
  'bot_link',
  'channel',
  'client_msg_id',
  'comment',
  'display_as_bot',
  'edited',
  'file',
  'file_comment',
  'icons',
  'inviter',
  'is_auto_split',
  'is_intro',
  'is_multiteam',
  'is_thread_broadcast',
  'item_type',
  'members',
  'mrkdwn',
  'name',
  'new_broadcast',
  'no_notifications',
  'old_name',
  'orphanned',
  'parent_user_id',
  'permalink',
  'plain_text',
  'purpose',
  'reactions',
  'replies',
  'reply_count',
  'room',
  'root',
  'slog_is_mpdm',
  'slog_is_self_dm',
  'slog_is_shared',
  'slog_is_slackbot_dm',
  'subtype',
  'text',
  'thread_ts',
  'timestamp',
  'topic',
  'ts',
  'type',
  'unread_count',
  'upload',
  'upload_reply_to',
  'user',
  'username',
];

const [,, sourceDir, destDir, ...options] = process.argv;

if (sourceDir == null) {
  throw new Error("First argument (the directory to read the slack export data from) is missing");
}

if (destDir == null) {
  throw new Error("Second argument (the directory to drop the exploded export data in) is missing");
}

const all_channels = options.includes("channels:all");
const all_dms = options.includes("dms:all");
const download_attachments = options.includes("download-attachments");

const _only_channels_option = options.find(o => o.indexOf("channels:only:") === 0);
const _except_channels_option = options.find(o => o.indexOf("channels:except:") === 0);
const _only_dms_option = options.find(o => o.indexOf("dms:only:") === 0);
const _except_dms_option = options.find(o => o.indexOf("dms:except:") === 0);

const only_channels = _only_channels_option == null ? null : _only_channels_option.split('channels:only:')[1].split(',');
const except_channels = _except_channels_option == null ? null : _except_channels_option.split('channels:except:')[1].split(',');
const only_dms = _only_dms_option == null ? null : _only_dms_option.split('dms:only:')[1].split(',');
const except_dms = _except_dms_option == null ? null : _except_dms_option.split('dms:except:')[1].split(',');

// These can be used for debugging. Add the log to the appropriate
// array during processing (i.e. in the `makeLog` function) if you
// want to examine the logs of a certain type.
const log_subtypes = [];
const channel_join_messages = [];
const channel_leave_messages = [];
const channel_name_messages = [];
const channel_topic_messages = [];
const channel_archive_messages = [];
const bot_add_messages = [];
const bot_remove_messages = [];
const channel_purpose_messages = [];
const file_mention_messages = [];
const slackbot_response_messages = [];
const reply_broadcast_messages = [];
const thread_broadcast_messages = [];
const me_message_messages = [];
const sh_room_created_messages = [];
const group_join_messages = [];
const group_leave_messages = [];
const group_purpose_messages = [];
const group_archive_messages = [];
const group_topic_messages = [];
const group_name_messages = [];
const file_share_messages = [];
const file_comment_messages = [];
const bot_messages = [];
const pinned_item_messages = [];
const untyped_messages = [];

main(
  require(path.join(sourceDir, "channels.json")),
  require(path.join(sourceDir, "dms.json")),
  require(path.join(sourceDir, "groups.json")),
  require(path.join(sourceDir, "integration_logs.json")),
  require(path.join(sourceDir, "mpims.json")),
  require(path.join(sourceDir, "users.json"))
).catch(err => {
  console.error(err);
}).then(() => {
  // This will happen both after main(...) returns successfully and when main(...) throws an error
  // Use this block to log any debug data. E.g., to log all processed messages with the 'file_share' subtype:
  // console.log(require('util').inspect({file_share_messages},undefined,Infinity));
  // Be sure to add the processed messages to the appropriate arrays (see comments in the `makeLog` function for an example)
});

async function main(channels, dms, groups, integration_logs, mpims, users) {
  const userMap = new Map(users.map(user => [user.id, user.profile.real_name]));
  const userShortNameMap = new Map(users.map(user => [user.id, user.name]));
  channels = [...channels, ...mpims, ...groups];
  let channels_to_process = [];
  let dms_to_process = [];
  if (all_channels) {
    channels_to_process = channels;
  } else {
    if (only_channels != null) {
      channels_to_process = only_channels.map(n => channels.find(R.propEq('name', n)));
      if (channels_to_process.some(ch => !ch)) {
        throw new Error('Some channels could not be found');
      }
    }
    if (except_channels != null) {
      if (only_channels != null) {
        channels_to_process = channels_to_process.filter(ch => !except_channels.includes(ch.name));
      } else {
        channels_to_process = channels.filter(ch => !except_channels.includes(ch.name));
      }
    }
  }

  if (all_dms) {
    dms_to_process = dms;
  } else {
    if (only_dms != null) {
      dms_to_process = only_dms.map(n => dms.find(R.propEq('id', n)));
      if (dms_to_process.some(dm => !dm)) {
        throw new Error('Some DMs could not be found');
      }
    }
    if (except_dms != null) {
      if (only_dms != null) {
        dms_to_process = dms_to_process.filter(dm => !except_dms.includes(dm.id));
      } else {
        dms_to_process = dms.filter(dm => !except_dms.includes(dm.id));
      }
    }
  }

  console.log(`Processing ${channels_to_process.length} channel${channels_to_process.length === 1 ? '' : 's'}`)
  for (const channel of channels_to_process) {
    await explodeChannel(channel, userMap);
  }

  console.log(`Processing ${dms_to_process.length} DM${dms_to_process.length === 1 ? '' : 's'}`)
  for (const dm of dms_to_process) {
    const channel = {
      name: dm.id,
      dirname: `dm_${dm.members.map(member => userShortNameMap.get(member)).join('-')}`
    };
    await explodeChannel(channel, userMap);
  }
}

async function explodeChannel(channel, userMap) {
  const channelExplodeDir = path.join(destDir, channel.dirname || channel.name);
  await mkdirp(channelExplodeDir);

  const writeStream = fs.createWriteStream(path.join(channelExplodeDir, "index.html"));
  await writeToLogFile(writeStream, LOG_FILE_HTML_PREPEND + LOG_FILE_HTML_CHAT_SECTION_PREPEND);
  const fileNames = await getChannelFileNames(channel);
  const numFiles = fileNames.length;
  let years = new Map();
  let i = 1;
  logUpdate(`exploding ${channel.name}: 0/${numFiles}`);
  for (const fileName of fileNames) {
    const date = path.basename(fileName).split('.json')[0];
    const sourceFile = path.join(sourceDir, channel.name, fileName);
    const fileLogs = require(sourceFile);
    const dayMoment = moment(date);
    const yearNum = dayMoment.format('YYYY');
    const monthNum = dayMoment.format('MMMM');
    const dayNum = dayMoment.format('DD');
    const {html: chatHtml, attachments, dayId, dayText} = generateChatHtml(userMap, fileLogs, dayMoment, sourceFile);
    const year = years.get(yearNum) || new Map();
    const month = year.get(monthNum) || [];
    month.push(`<a class="toc-day" href="#${dayId}" title="${dayText}">${dayNum}</a>`);
    if (!year.has(monthNum)) year.set(monthNum, month);
    if (!years.has(yearNum)) years.set(yearNum, year);
    const content = await downloadFilesAndRewriteLinks(chatHtml, attachments, channelExplodeDir);
    await writeToLogFile(writeStream, content);
    logUpdate(`exploding ${channel.name}: ${i++}/${numFiles}`);
  }
  await writeToLogFile(writeStream, LOG_FILE_HTML_CHAT_SECTION_APPEND + LOG_FILE_HTML_TOC_SECTION_PREPEND);
  let tocHtml = `<div class="years">`;
  years.forEach((months, year) => {
    tocHtml += `<div class="year"><span class="year-header">${year}</span><div class="months">`;
    months.forEach((days, month) => {
      tocHtml += `<div class="month"><span class="month-header">${month}</span><div class="days">`;
      tocHtml += days.join('');
      tocHtml += "</div></div>";
    });
    tocHtml += "</div></div>"
  });
  tocHtml += "</div>";
  await writeToLogFile(writeStream, tocHtml);
  await writeToLogFile(writeStream, LOG_FILE_HTML_TOC_SECTION_APPEND + LOG_FILE_HTML_APPEND);
  writeStream.close();
  logUpdate(`exploding ${channel.name}: complete.`);
  logUpdate.done();
}

function writeToLogFile(writeStream, content) {
  return new Promise((resolve, reject) => {
    writeStream.write(content, (err) => err ? reject(err) : resolve());
  });
}

function getChannelFileNames(channel) {
  return new Promise((resolve, reject) => {
    fs.readdir(path.join(sourceDir, channel.name), (err, fileNames) => {
      err ? reject(err) : resolve(fileNames);
    });
  });
}

function generateChatHtml(userMap, fileLogs, dayMoment, sourceFile) {
  const dayHeader = makeDayHeader(dayMoment);
  const header = `<div class="logs-for-day">${dayHeader.html}`;
  const footer = "</div>";
  const logs = fileLogs.reduce((agg, log) => {
    if (!log.thread_ts) return [...agg, log];
    const parent = fileLogs.find(l => l.ts === log.thread_ts);
    if (parent != null) {
      const reply = parent.replies.find(l => l.ts === log.ts);
      if (reply != null) {
        reply.log = log;
      } else {
        return [...agg, Object.assign(log, {orphanned: true})];
      }
    } else {
      return [...agg, Object.assign(log, {orphanned: true})];
    }
    if (log.replies) return [...agg, log];
    return agg;
  }, []);
  const [html, attachments] = logs.reduce(([htmlAgg, attachmentsAgg], log) => {
    try {
      const {html: logHtml, attachments: logAttachments} = makeLog(log, userMap);
      return [
        `${htmlAgg}${logHtml}`,
        [...attachmentsAgg, ...logAttachments],
      ];
    } catch (err) {
      if (err.message === 'Unknown log type') {
        console.log(`generateChatHtml encountered a log type or subtype it isn't familiar with. Please check out this log: sourceFile="${sourceFile}", timestamp="${log.ts}"`);
        console.log(err.log)
        return [htmlAgg, attachmentsAgg];
      }
      console.log(log);
      throw err;
    }
  }, [header, []]);
  return {
    html: html + footer,
    dayId: dayHeader.dayId,
    dayText: dayHeader.dayText,
    attachments,
  };
}

function makeDayHeader(dayMoment) {
  const dayText = dayMoment.format(DAY_FORMAT);
  const dayId = dayMoment.format(DAY_ID_FORMAT);
  return {
    html: `<h2><div class="left"><a class="day-link" href="#${dayId}" name="${dayId}">§</a><span class="day-text">${dayText}</span></div><div class="right"><a href="#toc">Back to top</a></div></h2>`,
    dayId: dayId,
    dayText: dayText,
  };
}

const USER_PATTERN = /<@[^>]+>/g;
const LINK_PATTERN = /<((?:http|tel|mailto)[^>]*)>/g;
const HTML_PATTERN = /<([^@>a/!#][^>]*)>/g;
const MENTION_PATTERN = /<!([^>]+)>/g;
const CHANNEL_PATTERN = /<#([^>]+)>/g;
const CODE_PATTERN = /\`\`\`(.+)\`\`\`/g;

function makeLog(log, userMap) {
  // if (!log_subtypes.includes(log.subtype)) log_subtypes.push(log.subtype);
  let user = userMap.get(log.user) || log.username || log.user || `UNKNOWN USER`;
  const date = moment(log.ts * 1000).format(TIME_FORMAT);
  const attachments = [];
  if (log.type !== 'message') {
    throw new Error('Unknown log type');
  }

  function extractUserId(text) {
    return text.split('<@')[1].split('>')[0].split('|')[0];
  }

  function userIdReplacer(match) {
    const id = extractUserId(match);
    const user = userMap.get(id) || 'UNKNOWN USER';
    return `<span class="referenced-user">@${user}</span>`;
  }
  function htmlEscaper(match, p1) {
    return `&lt;${p1}&gt;`;
  }
  function linkReplacer(match, p1) {
    const [href, caption] = p1.split('|');
    return `<a href="${href}" ${href.indexOf('http') === 0 ?'target="_blank"' : ''}>${caption || href}</a>`;
  }

  function mentionReplacer(match, p1) {
    const [id, caption] = p1.split('|');
    return `<span class="mention">${caption || `@${id}`}</span>`;
  }

  function channelReplacer(match, p1) {
    const [id, caption] = p1.split('|');
    return `<span class="channel-mention">#${caption || id}</span>`;
  }

  function codeReplacer(match, p1) {
    return `<pre class="multiline-code"><code>${p1}</pre></code>`;
  }

  function formatText(text) {
    return text
      .replace(LINK_PATTERN, linkReplacer)
      .replace(HTML_PATTERN, htmlEscaper)
      .replace(USER_PATTERN, userIdReplacer)
      .replace(MENTION_PATTERN, mentionReplacer)
      .replace(CHANNEL_PATTERN, channelReplacer)
      .replace(/^\n+|\n+$/g, "")
      .replace(/\n{3,}/g, "<br><br>")
      .replace(/\n/g, "<br>")
      .replace(CODE_PATTERN, codeReplacer);
  }

  let text = formatText(log.text || log.plain_text || '');
  let pinnedItemText = "";
  let botAttachmentsText = "";
  switch (log.subtype) {
    case 'channel_join':
      // channel_join_messages.push(log)
    case 'channel_leave':
      // channel_leave_messages.push(log)
    case 'channel_name':
      // channel_name_messages.push(log)
    case 'channel_topic':
      // channel_topic_messages.push(log)
    case 'channel_archive':
      // channel_archive_messages.push(log)
    case 'bot_add':
      // bot_add_messages.push(log)
    case 'bot_remove':
      // bot_remove_messages.push(log)
    case 'channel_purpose':
      // channel_purpose_messages.push(log)
    case 'file_mention':
      // file_mention_messages.push(log)
    case 'slackbot_response':
      // slackbot_response_messages.push(log)
    case 'reply_broadcast':
      // reply_broadcast_messages.push(log)
    case 'thread_broadcast':
      // thread_broadcast_messages.push(log)
    case 'me_message':
      // me_message_messages.push(log)
    case 'sh_room_created':
      // sh_room_created_messages.push(log)
    case 'group_join':
      // group_join_messages.push(log)
    case 'group_leave':
      // group_leave_messages.push(log)
    case 'group_purpose':
      // group_purpose_messages.push(log)
    case 'group_archive':
      // group_archive_messages.push(log)
    case 'group_topic':
      // group_topic_messages.push(log)
    case 'group_name':
      // group_name_messages.push(log)
    case 'file_share':
      // file_share_messages.push(log);
    case 'file_comment':
      // file_comment_messages.push(log);
      break;
    case 'bot_message':
      // bot_messages.push(log);
      if (user === 'UNKNOWN USER') {
        user = 'UNKNOWN BOT';
      }
      if (log.attachments) {
        if (log.attachments.length === 1) {
          const attachment = log.attachments[0];
          if (attachment.text && attachment.text.indexOf(" /gifs ") >= 0) {
            const [_user, _gifText] = attachment.text.split(': /gifs ');
            user = userMap.get(extractUserId(_user)) || 'UNKNOWN BOT';
            const [link, caption] = _gifText.split('<')[1].split('>')[0].split('|');
            text = `/gifs <a href="${attachment.image_url}" target="_blank">${caption || link}</a>`;
            break;
          }
          if (attachment.image_url && attachment.image_url.indexOf('.gif') >= 0 && attachment.text) {
            const [link, caption] = attachment.text.split('<')[1].split('>')[0].split('|');
            text = `<a href="${attachment.image_url}" target="_blank">${caption || link}</a>`;
            break;
          }
        }
        botAttachmentsText = log.attachments.reduce((agg, attachment) => {
          return `${agg}<div class="log-reactions"><pre><code>${formatText(JSON.stringify(attachment, null, 2))}</code></pre></div>`;
        }, "");
      }
      break;
    case 'pinned_item':
      // pinned_item_messages.push(log);
      if (log.attachments)
        pinnedItemText = log.attachments.reduce((agg, attachment) => {
          return `${agg}<div class="log-reactions"><span class="referenced-user">${userMap.get(attachment.author_id) || attachment.author_subname || 'UNKNOWN USER'} </span>${attachment.text.replace(LINK_PATTERN, linkReplacer).replace(HTML_PATTERN, htmlEscaper)}</div>`;
        }, "");
      break;
    default:
      if (log.subtype != null) {
        // This error will be caught and logged by the `generateChatHtml` function
        const e = new Error('Unknown log type');
        e.log = log;
        throw e;
      }
      // untyped_messages.push(log)
      break;
  }
  if (log.file != null) {
    attachments.push(log.file);
  }
  let replyText = "";
  if (log.thread_ts && log.orphanned) {
    replyText = `<div class="log-reactions">Replying to <span class="referenced-user">${userMap.get(log.parent_user_id) || 'UNKNOWN USER'}</span> from <span class="log-time">${moment(Number(log.thread_ts) * 1000).format(`${DAY_FORMAT} ${TIME_FORMAT}`)}</span></div>`;
  }
  if (log.thread_ts && log.replies && log.replies.some(r => r.log != null)) {
    replyText = `<div class="log-reactions">${log.replies.reduce((agg, reply) => {
      if (reply.log == null) return agg;
      const {html: _html, attachments: _attachments} = makeLog(reply.log, userMap);
      if (_attachments.length) {
        attachments.push(..._attachments);
      }
      return `${agg}<div class="log-reply">${_html}</div>`;
    }, "")}</div>`;
  }
  if (Object.keys(log).some(k => !KNOWN_LOG_KEYS.includes(k))) console.log('unknown key on log:', log);
  const html = `<div class="log"><div class="log-main"><strong class="user-name">${user}</strong><small class="log-time">${date}</small><span class="log-text">${text}</span></div>${pinnedItemText}${botAttachmentsText}${formatReactions(log.reactions, userMap)}${replyText}</div>`;
  return {
    html,
    attachments,
  };
}

function formatReactions(reactions, userMap) {
  if (reactions == null || reactions.length === 0) return "";
  return `<div class="log-reactions">${reactions.reduce((agg, reaction) => {
    return `${agg}<div class="log-reaction">${reaction.users.reduce((uAgg, user) => {
      if (uAgg == null) return `<span class="referenced-user">${userMap.get(user)}</span>`;
      else return [uAgg, `<span class="referenced-user">${userMap.get(user)}</span>`].join(', ');
    }, null)} reacted with <span class="log-reaction-type">${reaction.name}</span></div>`;
  }, "")}</div>`;
}

function mkdirp(path) {
  return new Promise((resolve, reject) => {
    _mkdirp(path, (err) => err ? reject(err) : resolve());
  });
}

async function downloadFilesAndRewriteLinks(html, attachments, dir) {
  const filesDir = path.join(dir, "files");
  await mkdirp(filesDir);
  await Promise.all(attachments.map(attachment => {
    const fileName = `${attachment.id}.${attachment.filetype}`;
    html = html.replace(attachment.permalink, `files/${fileName}`);
    if (!download_attachments) return Promise.resolve();
    const filePath = path.join(filesDir, fileName);
    return checkFileExists(filePath)
      .then(([exists, fd]) => {
        if (!exists) {
          return writeUrlResponseTo(attachment.url_private, filePath, fd);
        }
      });
  }));

  return html;
}

function writeUrlResponseTo(url, filePath, fd) {
  return new Promise((resolve, reject) => {
    request(url)
      .on('error', reject)
      .pipe(fs.createWriteStream(filePath, {fd}))
      .on('close', resolve);
  });
}

async function checkFileExists(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, 'wx', (err, fd) => {
      if (err) {
        if (err.code === 'EEXIST') {
          return resolve([true]);
        }
        return reject(err);
      }
      resolve([false, fd]);
    });
  });
}
