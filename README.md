# Slack Export Exploder

Downloads all uploaded files and generates an HTML page for each of the channels and DMs in an unzipped [Slack Export](https://get.slack.help/hc/en-us/articles/201658943-Export-your-workspace-data).

I wrote this specifically for my company's [Corporate Export](https://get.slack.help/hc/en-us/articles/201658943-Export-your-workspace-data#use-corporate-export), so I can't guarantee it will work for the other export types. Furthermore, I made several decisions about what types of log data needed to be stored. However, the code is very straightforward, so it should be easy to extend.

## Known Issues

* Occasionally, when using the `download-attachments` option, a download might fail and trigger an `ETIMEDOUT` exception. To get around that (because I'm lazy and didn't want to implement retry logic), I added the ability to specify channels and DMs to exclude, so you can just exclude the ones that were already processed and start from the last one that was processed.

* Even when not specifying the `download-attachments` option, the links in the resulting HTML are replaced with links to where the files would be downloaded. This was actually intentional, but should probably be made optional

* The HTML generator was very hackily thrown together, and there is not currently a way to alter the resulting HTML/CSS via any command line options

## Usage / Examples

```plaintext
node ./explode.js <SRC_DIR_OF_UNZIPPED_SLACK_EXPORT> <DEST_DIR_TO_CREATE_FILES> OPTIONS
  OPTIONS:
    "channels:all"
      - Will explode all channels (NOTE: this will override channels:only and channels:except)
    "channels:only:<channelname>,<channelname>,..."
      - Will only explode the provided channels
    "channels:except:<channelname>,<channelname>,..."
      - Will explode all channels except the provided channels
    "dms:all"
      - Will explode all DMs (NOTE: this will override dms:only and dms:except)
    "dms:only:<DM_Id>,<DM_Id>,..."
      - Will only explode the provided DMs
    "dms:except:<DM_Id>,<DM_Id>,..."
      - Will explode all DMs except the provided DMs
    "download-attachments"
      - Will also download the attachments
```

### Example 1

```bash
node ./explode.js ./slack-export-data ./exploded-slack-export channels:all dms:all download-attachments

# Will load the channels, dms, groups, integration_logs, mpims and users json
# files located in ./slack-export-data/, then loop over all of the
# channels+groups+mpims (collectively considered "channels" by the program)
# and create an HTML file for each channel by loading the channel's log folder

# Will then loop over the DMs and create an HTML file for them as well, but
# will name them based on the DM's two user's usernames
# (e.g. dm_cbankester-jsmith)
```

### Example 2
**NOTE:** This exmaple doesn't do anything! See below

```bash
node ./explode.js ./slack-export-data ./exploded-slack-export download-attachments

# Will do nothing, since no channels or DMs were specified and no `:all` options were provided
```

### Example 3

```bash
node ./explode.js ./slack-export-data ./exploded-slack-export dms:only:D8V3NAJ5Q,D77FJ1D3N channels:only:general,dev,it

# Will generate the HTML files for the two DMs with the provided id keys and
# for the three channels with the provided names. It will NOT download the
# uploaded files, but it WILL replace the links for those attachments in the
# resulting HTML with a link to where the attachment would be downloaded.
```
