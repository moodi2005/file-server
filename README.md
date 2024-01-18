
# File Server
This service makes it easy for us to upload and download and manage files in our projects and we no longer need to worry about this part in our projects.

## Api
|Name|  Method  |  Url |Options|Body
| :------------: | :------------: | :------------: | :------------: | :------------: |
| Upload  | POST  | /  | publich:boolean,token | id,name  |
| Serve  | GET  | /${NameFile}  | token(qury),view(qury)  | -  |


# Environment variables

 - tokenUpload
 - tokenDelete
 - port

#### Path Files : ./uploads
