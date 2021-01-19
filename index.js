/*
 * Initialises discord.js library
 * Retrieves configuration for bot runtime
 */
const Discord = require('discord.js');
const nodemailer = require('nodemailer');
const servers = require('./disc_config.json')

/*
 * Environment based imports
 */
const dotenv = require('dotenv');
dotenv.config();
const email = {
    "service": process.env.EMAILSERVICE,
    "user": process.env.EMAILUSER,
    "pass": process.env.EMAILPASS
}
const auth = {
    "token": process.env.DISCORDTOKEN
}
const serviceAccount = {
    "type": process.env.SERVICETYPE,
    "project_id": process.env.SERVICEPROJECTID,
    "private_key_id": process.env.SERVICEPRIVATEID,
    "private_key": process.env.SERVICEPRIVATEKEY.replace(/\\n/g, '\n'),
    "client_email": process.env.SERVICECLIENTEMAIL,
    "client_id": process.env.SERVICECLIENTID,
    "auth_uri": process.env.SERVICEAUTHURI,
    "token_uri": process.env.SERVICETOKENURI,
    "auth_provider_x509_cert_url": process.env.SERVICEAUTHPROVIDERCERT,
    "client_x509_cert_url": process.env.SERVICECLIENTCERT
  }

const database_uri = {
    "uri": process.env.DATABASEURI
}
/*
 * Initialises bot and Discord API keys
 */
const bot  = new Discord.Client();
const admin = require("firebase-admin");

var guilds = {};

var email_transporter;
/*
 * Initialises Firebase API keys
 */

const { user } = require('firebase-functions/lib/providers/auth');


/*
 *  Login DISCORD BOT with custom token
 */
bot.login(auth.token);

/*
 *  Initialise FIREBASE connection
 */
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: (database_uri.uri)
});

/*
 *  Initialise FIREBASE database reference pointers
 */
const database = admin.database();

/*
 *  Configured variable to ensure configuration worked correctly
 */
var configured = false;

/*
 * ==================================================
 *              Discord Event Listeners
 * ==================================================
 */

/*
 * On Bot load up, attempt to configure it. If configuration is successful
 * notify admins on 'log' channnel
 */
bot.on('ready', () => {
    console.log("Attempting to run bot!");
    configure().then(function(){
        console.log("Bot running!");
        setTimeout(function(){notify_unverified_users()}, 2000);
    }).catch(console.log);
});

/*
 * Check for command '!notify_unverified' which notifies all unverified users by sending them their custom auth url
 * Should be done every time the Discord Bot is reloaded to deal with any users who joined while the bot was offline
 */
bot.on('message', message => {
    if(message.content === '!notify_unverified' && message.member != null && message.member.hasPermission("ADMINISTRATOR")){
        notify_unverified_users();
    }
});


/*
 * Check for command '!kick <user>' which kicks a user a deletes their data from the db
 */
bot.on('message', message => {
    if(message.content.startsWith('!kick') && message.member != null && message.member.hasPermission("ADMINISTRATOR")){
        message.mentions.users.forEach(function(user){
            var guildmember = get_member(user.id, message.guild);
            if(guildmember != null){
                guildmember.kick();
                log("Kicked member:" + guildmember.nickname + " with discord id:" + guildmember.id, message.guild.id);
            }else{
                log("No member found with id:" + user.id, message.guild.id);
            }
        });
    }
});

/*
 * Check for command '!help' which lists all commands
 */
bot.on('message', message => {
    if(message.content === '!help' && message.member != null){
        if(message.member.hasPermission("ADMINISTRATOR")){
            print_commands();
        }else{
            var member = message.member;
            member.send("=====================COMMANDS====================");
            member.send("!help (Shows commands)");
            member.send("!meeting [<user>] (Creates a meeting of users, or will add the users to the current room)");
            member.send("=================================================");
        }
        message.delete();
    }
});

/*
 * Check for command '!logs' which prints all logs in the current bot session
 */
bot.on('message', message => {
    if(message.content === '!logs' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        var logbook = guilds[message.guild.id].logbook
        log("-----BEGIN LOGBOOK-----", message.guild.id);
        log("LOGS:" + logbook.length, message.guild.id);
        logbook.forEach((log) => log("`"+log+"`", message.guild.id));
        log("-----END   LOGBOOK-----", message.guild.id);
    }
});

/*
 * Check for command '!committee' and a mention which gives the committee role to a member
 */
bot.on('message', message => {
    if(message.content.startsWith('!committee') && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        if(message.mentions.users.size > 1){
            log("Can only add one user at a time to committee for security reasons :)", message.guild.id);
            message.delete();
            return;
        }
        message.mentions.users.forEach(function(member){
            var guildmember = get_member(member.id, message.guild);
            if(guildmember == null){
                log("Trying to add member to committee but unknown member with userid: " + member.id, message.guild.id);
            }else{
                guildmember.roles.add(guilds[message.guild.id].committee_role).catch((error)=>log("Tried adding member:" + member.id + "to committee but failed with error:" + error));
                log("Successfully added member " + member.username+ " to committee group :) by user with username:" + message.author.username,  message.guild.id);
                
            }
        });
        message.delete();
    }
});

/*
 * Check for command '!clear_log_chat' which clears the chat
 */
bot.on('message', message => {
    if(message.content === '!clear_log_chat' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        message.reply("Deleting logs!");
        guilds[message.guild.id].log_channel.messages.cache.forEach((message)=> message.delete());
    }
});

/*
 * Check for command '!config' which prints the server configuration
 */
bot.on('message', message => {
    if(message.content === '!config' && message.member != null && message.member.hasPermission("ADMINISTRATOR") && configured){
        print_server_config();
    }
});
/*
* When a member is added, log them joining and send them their custom auth url
*/
bot.on('guildMemberAdd', member => {
    curr_guild = guilds[member.guild.id];
    member.send("Welcome to the "+ curr_guild.organisation +" Discord Server!");
    log("New Member Joined:" + member.displayName, member.guild.id);
    if(configured){
        guilds[member.guild.id].welcome_channel.send("Hello <@" + member.id + ">! I've sent you a link to verify your status as a "+ curr_guild.organisation + " Member!\nPlease check your DMs!");
    }
    send_user_auth_url(member);
});

/*
 * ==================================================
 *                DATABASE LISTENERS
 * ==================================================
 */

async function on_queue(snapshot, prevChildKey, guild_id){
    curr_guild = guilds[guild_id];
    if(!configured){
        console.log("Not configured, can't deal with queue!");
        return;
    }
    db_user = snapshot.val();
    var member = await get_member_uncached(db_user.id, curr_guild.guild);
    if(member == null){
        log("User not found through login with shortcode:" + db_user.name + ". Discord ID attempted:" + db_user.id, guild_id);
        curr_guild.queue_ref.child(snapshot.key).remove();
    }else{
        var shortcode = db_user.shortcode;
        var course = db_user.course;
        var year = db_user.year;
        curr_guild.verified_users.child(shortcode).once('value', async function(fetched_snapshot){
            await get_shortcode(db_user.id, curr_guild).then(async function(alternate_shortcode){
                if((alternate_shortcode[0] || shortcode) != shortcode){
                    member.send("IMPORTANT:You're already verified under "+alternate_shortcode[0]+"! Someone just tried to reverify this account! \n\nDid you send someone your authentication link or try and reuse it yourself! This account is already registered to a shortcode. If you wish to update any information e.g. course or year, please contact an admin");
                    log("Member already verified with discord id " + member.id + " and member with shortcode: " + shortcode + " attempted to reverify this account. This is not allowed!", guild_id);
                    curr_guild.queue_ref.child(snapshot.key).remove();
                    return;
                }
                else if(fetched_snapshot.val() === null || fetched_snapshot.val().disc_id === db_user.id){
                    if(fetched_snapshot.val() !== null && fetched_snapshot.val().disc_id === db_user.id){
                        //Reset member roles
                        await member.roles.set([]);
                    }
                    member.setNickname(db_user.name).catch((error)=>log("Can't set the nickname:" + db_user.name + " for this user(id):" + member.id + "->" + error, guild_id));
                    member.roles.add(curr_guild.roles["Verified"])
                    if(Object.keys(curr_guild.roles).includes(course)){
                        member.roles.add(curr_guild.roles[course]);
                    }else{
                        log("Unidentified course :" + course + " when trying to add member" + db_user.name, guild_id);
                    }
                    if(Object.keys(guilds[guild_id].year_roles).includes(year)){
                        member.roles.add(curr_guild.year_roles[year]);
                    }else{
                        log("Unidentified year :" + year + " when trying to add member" + db_user.name, guild_id);
                    }

                    log("Member : "+ db_user.name +" signed up successfully with username: " + member.user.username + " and id: " + member.user.id +" and course group: "+course+" and year: "+ year +"!", guild_id);
                    var userid = member.toJSON().userID.toString();
                    curr_guild.verified_users.child(shortcode).set({"username": member.user.username, "name": db_user.name, "disc_id" : userid, "email": db_user.email, "course": course, "year": year});
                    member.send(curr_guild.verified_msg);
                }else{
                    log("Member: " + db_user.name + " signed in successfully. \n However this shortcode is already associated with discord id: "+ fetched_snapshot.val().disc_id + "\n so can't be associated with discord id: " + snapshot.val().id, guild_id);
                    member.send("This shortcode is already registered to a Discord User!");
                    member.send('If you believe this is an error, please contact an Admin');
                }
                curr_guild.queue_ref.child(snapshot.key).remove();
            })
        })
    }
}


/*
 * ==================================================
 *                  HELPER FUNCTIONS
 * ==================================================
 */

/*
 * Logs to both console and to discord log channel if it exists
 */
function log(log, guild_id){
    console.log(log);
    var curr_guild = guilds[guild_id];
    if(curr_guild != null){
        logbook = curr_guild.logbook;
        log_channel = curr_guild.log_channel;
        logbook.push(new Date(Date.now()).toLocaleString() + ":" + log);
        log_channel.send("`"+log+"`");
    }
}

/*
 * Gets a channel given an id 
 * Pre: configured
 */
function get_channel(id, guild){
    return guild.channels.cache.get(id);
}

/*
 * Gets a role given an id 
 * Pre: configured
 */
async function get_role(role_id, guild){
    var result = await guild.roles.fetch(role_id).then(role=>role);
    return result;
} 

/*
 * Gets a member given an id 
 * Pre: configured
 */
function get_member(id, guild){
    return guild.member(id);
}

/* 
 * Gets a member given an id (not cached)
 */
async function get_member_uncached(id, guild){
    return await guild.members.fetch(id);
}

/*
 * Prints the server configuration
 */
function print_server_config(guild_id){
    log("Server Config:\n-> SERVER: " + guilds[guild_id].toString(), guild_id);    
}

/*
 * Prints the commands 
 */
function print_commands(guild_id){
    log("-----------COMMANDS-------------\n !help (Shows commands)\n !notify_unverified (Sends URL's to all unverified users)\n !kick [<user>] (Kicks mentioned users\n !logs (View all logs!)\n !clear_log_chat (Clear the log chat from this runtimes logs)\n !config (Prints the Server config)\n !committee <user> (Gives a single user committee role, user @ to mention them as the argument!)",
    guild_id);
}

/*
 * This function iterates through all unverified users and sends them their custom
 * authentication URL
 */
async function notify_unverified_users(){
    var notifications = 0;
    if(configured){
        for(var guild_id in guilds){
            guilds[guild_id].guild.members.fetch().then((members)=>{
                log("Beginning: Notifiying Unverified Users", guild_id);
                members.forEach((guildMember)=>{
                    if(!guildMember.roles.cache.find( role => role.id === guilds[guild_id].roles.Verified.id)){
                        send_user_auth_url(guildMember);
                        notifications++;
                    }
                });
                log(notifications + " users notified!\n Ending: Notifiying Unverified Users", guild_id);
                notifications = 0;
            });
        }
        
    }else{
        console.log("Can't send verification stuff, configuration not set!");
    }
}


/*
 * Given a member object, sends the member their custom auth url
 */
function send_user_auth_url(member){
    var guild = guilds[member.guild.id];
    member.send(guild.welcome_msg).catch((error)=>{log("Error trying to send: " + member + " a message")});
    member.send(guild.auth_web_url+ member.id).catch((error)=>{log("Error trying to send: " + member + " a message")});
    member.send("This link will only work for your account! There is no point sharing it with other users").catch((error)=>{log("Error trying to send: " + member + " a message")});
    log("Sent custom URL to user: " + member.displayName + " for verification", member.guild.id);
}

/*
* Fetch user shortcode from userid
*/
async function get_shortcode(disc_id, guild){
    var result = [];
    await guild.verified_users.orderByChild("disc_id").equalTo(disc_id).once('value').then(
        function(super_snap){
            if(super_snap.exists()){
                //Accounting for issue that may be multiply shortcodes associated to discord id
                //Bot won't like it, but it'll work, functionality only enabled for first result
                result = Object.keys(super_snap.val());
            }
        }
    ).catch(function(error){
        log("Tried to fetch the shortcode of a user with discord id: " + disc_id + "Failed with error:\n" + error, guild.guild.id);
    });
    return result;
}

/*
 * Configures basics e.g. guild, log channel, verified role by fetching id from disc_config.json
 * If configuration fails, the bot should stop running after logging error!
 */
async function configure(){
    try{
        //Create email transporter object
        email_transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 465,
            secure: true, 
            auth: {
                user: email.user,
                pass: email.pass
            }
        });
        for(var ind in servers){
            server = servers[ind];
            console.log("Beginning configure for server: " + server.SERVER_NAME);
            curr_guild = {}
            curr_guild.server_name = server.SERVER_NAME;
            curr_guild.welcome_msg = server.WELCOME_MESSAGE;
            curr_guild.verified_msg = server.VERIFIED_MESSAGE;
            console.log(curr_guild);
            curr_guild.auth_web_url = server.AUTH_WEBSITE_URL;
            curr_guild.organisation = server.ORGANISATION;
            curr_guild.logbook = [];
            curr_guild.guild = bot.guilds.cache.get(server.SERVER_ID);
            curr_guild.log_channel = get_channel(server.LOG_CHANNEL_ID, curr_guild.guild);
            curr_guild.welcome_channel = get_channel(server.WELCOME_CHANNEL_ID, curr_guild.guild);

            //Populate roles
            curr_guild.roles = {};
            for(var role in server.roles){
                console.log("Fetching role: " + role);
                curr_guild.roles[role] = await get_role(server.roles[role], curr_guild.guild).then((role)=> role).catch((error)=>log("Role fetch error on role " + role + " with error" + error, server.SERVER_ID));
            }

            curr_guild.year_roles = {};
            for(var role in server.years){
                //Left as console log to reduce initialisation spam
                //Errors will be sent to server
                console.log("Fetching year role: " + role);
                curr_guild.year_roles[role] = await get_role(server.years[role], curr_guild.guild).then((role)=> role).catch(log);
            }
            //Left as console log to reduce initialisation spam
            //Errors will be sent to servercons
            console.log("Fetching committee role");
            curr_guild.committee_role = await get_role(server.COMMITTEE_ROLE_SAFE, curr_guild.guild).then((role)=>role).catch(log);
            curr_guild.queue_ref = database.ref(server.SERVER_NAME + "/queue");
            curr_guild.verified_users = database.ref(server.SERVER_NAME + "/users");

            curr_guild.queue_ref.on("child_added", async function(snapshot,prevChildKey){
                if(!configured){
                    await configure();
                }
                on_queue(snapshot,prevChildKey, server.SERVER_ID)
            });

            guilds[server.SERVER_ID] = curr_guild;
            log("-----------BOT BEGINS-----------", server.SERVER_ID);
            print_server_config(server.SERVER_ID);
        }
    } catch(error){
        console.log("FATAL!!!");
        console.log("CONFIGURATION FAILED WITH ERROR:");
        console.log(error);
    } finally{
        configured = true;
        console.log("-----------BOT BEGINS-----------");
        console.log("Bot Configured successfully!");
    }
}