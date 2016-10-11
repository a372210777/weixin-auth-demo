var mongoose = require('mongoose');
var util = require("../util/utility");
// var request=require('superagent');
var request=require('request');
var fs = require('fs');
var sha1 = require('sha1');

const AccessTokenBase = mongoose.model('AccessTokenBase');
const AccessTokenAuth = mongoose.model('AccessTokenAuth');
const Ticket = mongoose.model('Ticket');
const User = mongoose.model('User');

const appId = 'wx172b51436ce5f123';
const appSecret = '8aa55e17f3755940507aa35300e4ccd2';
/**
网页授权通过code换取accessToken和openId
对于scope为snsapi_userInfo获取的accessToken 该token通过特定URL获取用户信息(见文档网页授权页面)该方法适用于用户未关注
公众号下用户主动授权来获取用户资料，非静默方式即有相应授权界面.且维护accessToken防止过期(见文档网页授权页面) 该accessToken仅能获取访问用户信息接口
而基础支持中的accessToken则可以访问文档接口权限中对公众号开放权限的接口

对于scope为nsapi_base 获取到的accessToken 实际上没有用处，也就说该类型scope只能用来获取用户openId,若要获取用户信息则需要使用基础支持中的
accessToken,和该授权返回的openId 并且该用户已经关注了公众号 未关注依旧无法用户信息 通过文档--用户管理--》用户基本信息接口 获取用户资料
该方式为静默方式用户无感觉

对于从公众号对话框进入到网页的则scope无论指定哪种均按照静默方式流程即scope为nsapi_base
如果从微信内置浏览器进入网页则要则先使用base方式来获取用户信息，通过返回的subscribe字段判断用户是否已经关注公众号，为0则没关注，重新使用userInfp
形式拉取用户信息

网页授权中两种scope均能够获取用户的openId,
对于snsapi_base 获取完openId后则需通过基础支持接口中的accessToken和openId来获取用户信息(文档用户管理-->用户基本信息)前提是用户已经
关注了该公众号 否则依旧获取不到用户信息
*/
const accessTokenUrl='https://api.weixin.qq.com/sns/oauth2/access_token?'
// appid=APPID&secret=SECRET&code=CODE&grant_type=authorization_code'

/**
基础支持即不通过授权 只用appId和appSecret换取 accessToken 该token能够访问微信所有开放接口包括用户基本信息(文档用户管理-->用户基本信息)
*/
const baseAccessTokenUrl='https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+appId+'&secret='+appSecret

const baseUserInfoUrl="https://api.weixin.qq.com/cgi-bin/user/info";//用户管理-->获取用户信息地址
const authUserInfoUrl="https://api.weixin.qq.com/sns/userinfo"//非静默授权获取用户信息地址

const ticketUrl='https://api.weixin.qq.com/cgi-bin/ticket/getticket'//微信JSSDK配置 ticket获取链接

module.exports=function(app){


  function getOpenIdByCode(req,res,next){
    var code = req.params.code;
    var state = req.params.state;//base or userInfo
    if(!code){
        res.send( util.error('缺失code') )
        return next();
    }
    var url=accessTokenUrl+'appid='+appId+"&secret="+appSecret+"&code="+code+"&grant_type=authorization_code"
    var option={
      url:url
    }
    request(option,function(error, response, body){
      if (!error && response.statusCode == 200) {
         var info = JSON.parse(body);
         console.log("===>["+state+"]授权code换取openID:",info);
         var openId = info.openid;
         var aToken = info.access_token;
         /* 客户端发起scope为base的操作 根据code换取openId 根据openId从数据库查找USERINFO-->查找不到-->判断scope
         scope=base ==>拉取用户信息-->判断返回subscribe-->为0-->服务器吐出空数据-->客户端判断数据为空-->则按照userinfo重新拉取用户信息
         scope = userinfo==>
         */
         User.findOne({openid:openId}).exec(function(err,user){
           if(user){
             console.log("===>从数据库拉取用户信息",user)
             res.send( util.success(user) )
             return next()
           }
           //用户不存在

           if(state=='base'){
              getBaseAccessToken(function(baToken){

                var url = baseUserInfoUrl+"?access_token="+baToken+"&openid="+openId+"&lang=zh_CN";
                request({url:url},function(error, response, body){
                  if (!error && response.statusCode == 200) {
                     var userInfo = JSON.parse(body);
                     //用户未订阅公众号 无法获取基本资料 ,则返回空内容让客户端再发起一个新的userinfo 授权请求
                     if(userInfo.subscribe=='0'){
                      console.log("===>[base]"+"用户未关注公众号返回空数据")
                       res.send(util.success(null))
                     }else{
                       console.log("===>[base]用户关注公众号返回数据",userInfo)
                       var sex = userInfo.sex == '1' ? "男" : "女";
                       new User({
                         openid:userInfo.openid,
                         nickname:userInfo.nickname,
                         sex:sex,
                         language:userInfo.language,
                         city:userInfo.city,
                         province:userInfo.province,
                         country:userInfo.country,
                         portrait:userInfo.headimgurl,
                         subscribe_time:new Date(userInfo.subscribe_time),
                         unionid:userInfo.unionid,
                         subscribe:'1'
                       }).save(function(err,result){
                         res.send( util.success(result) );
                       })
                     }
                   }
                })

              })
          //授权scope类型为userinfo
           }else{

              //对于scope为userinfo的accesToken是否需要维护？
             var url = authUserInfoUrl+"?access_token="+aToken+"&openid="+openId+"&lang=zh_CN";
             request({url:url},function(error, response, body){
               if (!error && response.statusCode == 200) {
                  var userInfo = JSON.parse(body);
                  console.log("===>[userinfo]非静默方式获取用户信息",userInfo)

                  var sex = userInfo.sex == '1' ? "男" : "女";
                  new User({
                    openid:userInfo.openid,
                    nickname:userInfo.nickname,
                    sex:sex,
                    language:userInfo.language,
                    city:userInfo.city,
                    province:userInfo.province,
                    country:userInfo.country,
                    portrait:userInfo.headimgurl,
                    subscribe_time:new Date(userInfo.subscribe_time),
                    unionid:userInfo.unionid,
                    subscribe:'0'
                  }).save(function(err,result){
                    res.send( util.success(result) );
                  })

                }else{
                    res.send( util.error("获取用户信息失败",error) );
                }
             })


           }

         })

        //  res.send( util.success(info) )
       }else{
         res.send( util.error(error) )
       }
    })
  }



/*
* 通过opendId和基础支持的accessToken（文档--开始开发--获取接口调用凭证）来获取用户信息，前提是用户已经关注了公众号，
  对于没有关注公众号的用户则需要是snsapi_userinfo来授权获取并用网页授权返回的acccessToken换取用户信息
*/
  function testGetBaseUserInfo(req,res,next){
    var accesToken = 'TB2z74p0PJmvL1300SPKittQZLAkYkmHvgAr937liQQskF1CQllSuGuUrDx3qlr9yFI5KyzkcQxAk-XmDdc5Iz1VqDht5oViozglwgGg9Oe6u3Phlcokwpu1NEyfW9IyQMLaACADZY'
    var openId = "oKLoEwgPFkGo_CzSbx4OJJ_bs34U";
    var url = baseUserInfoUrl+"?access_token="+accesToken+"&openid="+openId+"&lang=zh_CN";
    request({url:url},function(error, response, body){
      if (!error && response.statusCode == 200) {
         var info = JSON.parse(body);
         console.log("用户信息:",info);
         res.send( util.success(info) )
       }else{
         res.send( util.error(error) )
       }
    })

  }



  function getUserInfoByAuth(req,res,next){
    var accesToken=''
    var openId="oKLoEwgPFkGo_CzSbx4OJJ_bs34U";
    var url = authUserInfoUrl+"?access_token="+accesToken+"&openid="+openId+"&lang=zh_CN";
    request({url:url},function(error, response, body){
      if (!error && response.statusCode == 200) {
         var info = JSON.parse(body);
         console.log("用户信息:");
         console.log(info);
         res.send( util.success(info) )
       }else{
         res.send( util.error(error) )
       }
    })

  }

  /*
  * 基础支持AccesToken获取
  */
  function getBaseAccessToken(callback){

    AccessTokenBase.count().exec(function(err,count){
      if(count){
        AccessTokenBase.findOne().exec(function(err,accessToken){

          var expireAt = new Date(accessToken.createAt).getTime() + 2*60*60*1000;//token过期时间
          if(expireAt >= Date.now()){
            console.log("===>从数据库获取accesToken",accessToken)
            var token=accessToken.accessToken;
            callback(token)
          }else{
            request({url:baseAccessTokenUrl},function(error, response, body){
              if (!error && response.statusCode == 200) {
                 var info = JSON.parse(body);
                 var aToken = info.access_token;
                 console.log("===>基础接口accessToken:"+aToken);
                 accessToken.accessToken=aToken;
                 accessToken.createAt=Date.now();
                 accessToken.save();
                 callback(aToken)
               }
            })
          }
        })
      }else{

        request({url:baseAccessTokenUrl},function(error, response, body){
          if (!error && response.statusCode == 200) {
             var info = JSON.parse(body);
             var aToken = info.access_token;
             console.log("===>基础接口获取accesToken:"+aToken);
             new AccessTokenBase({accessToken:aToken}).save()
             callback(aToken);
           }
        })

      }
    })
  }


  function getJsSdkConfig(req,res,next){
    var currentUrl = req.params.url;

    Ticket.findOne().exec(function(err,ticket){
      if(ticket){
          var expireAt = new Date(ticket.createAt).getTime() + 2*60*60*1000;
          if(expireAt >= Date.now()){
            var config = getConfig(ticket.ticket,currentUrl)
            console.log("===>数据库获取ticket信息",config)
            res.send( util.success(config) )
          }else{

              getBaseAccessToken(function(aToken){
                var url = ticketUrl + '?access_token='+aToken+'&type=jsapi';
                request({url:url},function(error, response, body){
                  if (!error && response.statusCode == 200) {
                     var tk = JSON.parse(body);
                     ticket.ticket = tk.ticket;
                     console.log("===>用accesToken换取Ticket",config)
                     ticket.save();
                     var config = getConfig(tk.ticket,currentUrl)
                     res.send( util.success(config) )

                   }else{
                     res.send( util.error(error) )
                   }
                })
              })


          }

      }else{
        // {
        // "errcode":0,
        // "errmsg":"ok",
        // "ticket":"bxLdikRXVbTPdHSM05e5u5sUoXNKd8-41ZO3MhKoyN5OfkWITDGgnr2fwJ0m9E8NYzWKVZvdVtaUgWvsdshFKA",
        // "expires_in":7200
        // }

        getBaseAccessToken(function(aToken){
          var url = ticketUrl + '?access_token='+aToken+'&type=jsapi';
          request({url:url},function(error, response, body){
            if (!error && response.statusCode == 200) {
               var ticket = JSON.parse(body);
               new Ticket({ ticket:ticket.ticket }).save()
               var config = getConfig(ticket.ticket,currentUrl)
               res.send( util.success(config) )

             }else{
               res.send( util.error(error) )
             }
          })
        })



      }
    })


  }

  function getConfig(ticket,url){
    var noncestr = 'WY3WZYTPz0kzccnW';
    var timestamp = Date.now();
    var str = 'jsapi_ticket='+ticket + "&noncestr="+noncestr + "&timestamp="+timestamp+"&url="+url;
    var signature = sha1(str)
    return {
      noncestr:noncestr,
      timestamp:timestamp,
      signature:signature
    };
  }


function geoLocation(req,res,next){

  var long = req.params.long;//经度
  var lat = req.params.lat;//维度

  if(!long || !lat ){
    res.send( util.error("参数缺失") )
    return next()
  }

  //维度前，经度后
  // var url = "http://api.map.baidu.com/geocoder/v2/?ak=ISdLGjxBc6qGCpveAgRNCYZqbKOw1ytq&coordtype=wgs84ll&location="+lat+","+long+"&output=json&pois=0"
  var url = "http://api.map.baidu.com/geocoder/v2/?ak=soAXo1XoypnI5XH63m8fdDO7&coordtype=wgs84ll&location="+lat+","+long+"&output=json&pois=0"
  console.log("===>URL:"+url)
  request({url:url},function(error, response, body){
    if (!error && response.statusCode == 200) {
      console.log("===>")
      console.log(body)
      // var result = JSON.parse( body.substring(29,body.length-1) )
      var result = JSON.parse( body )
       console.log("===>",result);
       res.send( util.success(result) )

     }else{
       res.send( util.error(error) )
     }
  })


}


/*
* 发送模板消息
 openId发送用户ID 模板ID,点击通知跳转链接,数据，成功回调,失败回调
*/
function sendTemplateMsg(openId,tempId,jumpUrl,data,success,fail){

  getBaseAccessToken(function(aToken){

    var url='https://api.weixin.qq.com/cgi-bin/message/template/send?access_token='+ aToken;
    var option = {
      url:url,
      method:'POST',
      json:true,
      headers:{
        "Content-type": "application/json"
      },
      body:{
        "touser":openId,
         "template_id":tempId,
        //  "url":jumpUrl,
         "data":data
      }
    }
    if(jumpUrl){
      option.body.url = jumpUrl;
    }

    request(option,function(error, response, body){
      if (!error && response.statusCode == 200) {
        //  var info = JSON.parse(body);
         console.log("===>发送模板消息结果",body)
         success(body)
       }else{
         fail(error)
       }
    })
  })

}



  /**
   * 根据code获得用户的openid
   */
  app.get('/api/v1/wx/getOpenIdbyCode', getOpenIdByCode);
  /*
  * 获取js-sdk参数配置
  */
  app.get('/api/v1/wx/getJsSdkConfig',getJsSdkConfig )

  /*
  * 经纬度转地址
  */
  app.get('/api/v1/wx/geoLocation',geoLocation )
  /**
   * openid换取用户信息
   */


  app.get('/api/v1/wx/getBaseUserInfo', testGetBaseUserInfo);
  /*
  * 基础AccesToken获取
  */
  app.get('/api/v1/wx/getBaseAccessToken', testBaseToken);


/*
* 微信模板消息推送 如下单成功 支付成功等
*/
app.get('/api/v1/wx/testSendTemplate',function(req,res,next){

  getBaseAccessToken(function(aToken){

    var url='https://api.weixin.qq.com/cgi-bin/message/template/send?access_token='+ aToken;
    var option = {
      url:url,
      method:'POST',
      json:true,
      headers:{
        "Content-type": "application/json"
      },
      body:{
        "touser":"oKLoEwgPFkGo_CzSbx4OJJ_bs34U",
         "template_id":"sdhdbjGLGa0JlS2Y09m62s0beD3D549dFu8UZ-2U4uk",
        //  "url":"http://weixin.qq.com/download",
         "data":{
                 "first": {
                     "value":"您的订金支付成功！",
                     "color":"#173177"
                 },
                 "keyword1":{
                     "value":"12456789",
                     "color":"#173177"
                 },
                 "keyword2": {
                     "value":"39.8元",
                     "color":"#173177"
                 },

                 "remark":{
                     "value":"欢迎使用小天鹅智能洗衣机！",
                     "color":"#173177"
                 }
         }
      }
    }
    request(option,function(error, response, body){
      if (!error && response.statusCode == 200) {
        //  var info = JSON.parse(body);
         console.log("===>发送模板消息结果",body)
         res.send(body);
       }
    })

  })


})


app.get('/api/v1/wx/testGetTemplate',function(req,res,next){
  getBaseAccessToken(function(aToken){

    var url='https://api.weixin.qq.com/cgi-bin/template/get_industry?access_token='+ aToken
    var getTemplateList = 'https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=' + aToken
    request({url:getTemplateList},function(error, response, body){
      if (!error && response.statusCode == 200) {
         var info = JSON.parse(body);
         console.log("===>获取设置的行业信息",info)
         res.send(info);
       }
    })

  })


})




  function testBaseToken(req,res,next){
    request({url:baseAccessTokenUrl},function(error, response, body){
      if (!error && response.statusCode == 200) {
         var info = JSON.parse(body);
         var accesToken = info.access_token;
         console.log("基础接口accesToken:"+accesToken);
         fs.writeFile('accessToken.txt',accesToken, (err) => { if (err) throw err; console.log('It\'s saved!'); });
         res.send(info);
       }
    })
  }

}
