FROM ubuntu:21.10
LABEL author="Chico Figueiredo"
# Apache ENVs
ENV APACHE_RUN_USER www-data
ENV APACHE_RUN_GROUP www-data
ENV APACHE_SERVER_NAME bolao.maxmat1.com.br
ENV APACHE_SERVER_ADMIN fran.fig@gmail.com
ENV APACHE_SSL_PORT 443
ENV APACHE_LOG_LEVEL info
ENV APACHE_SSL_LOG_LEVEL info
ENV APACHE_SSL_VERIFY_CLIENT optional
ENV APACHE_HTTP_PROTOCOLS http/1.1
ENV APPLICATION_URL https://${APACHE_SERVER_NAME}:${APACHE_SSL_PORT}

ARG DEBIAN_FRONTEND=noninteractive

RUN apt update && \ 
    apt -y upgrade 

RUN apt install -y apache2 apache2-utils cron bash wget curl git lynx tzdata apt-transport-https ca-certificates software-properties-common

# RUN apt install -y software-properties-common && \ 
#    add-apt-repository ppa:certbot/certbot && \ 
#    apt update && \ 

RUN apt-get install -qq certbot python3-certbot-apache && \
    rm -rf /var/www/localhost/cgi-bin/ && \ 
    mkdir -p /webroots/evsoul.com/.well-known /scripts 

# /webroots/DOMAIN.TLD/.well-known/... files go here
VOLUME /webroots
VOLUME /etc/letsencrypt

RUN a2enmod ssl \
    && a2enmod headers \
    && a2enmod rewrite \
    && a2dismod mpm_prefork \
    && a2dismod mpm_event \
    && a2enmod mpm_worker \
    && a2enmod proxy_fcgi \
    && a2enmod http2 \
    && a2enmod proxy \
    && a2enmod proxy_http \
    && a2enmod proxy_balancer \
    && a2enmod proxy_http  \
    && a2enmod proxy_html \
    && a2enmod remoteip \
    && a2enmod ssl \
    && a2enmod lbmethod_byrequests \
    && a2enmod xml2enc \
    && a2ensite default-ssl 
    #&& a2enconf ssl-params \
    #&& a2enconf xml2enc \
    #&& a2enconf lbmethod_byrequests \
    #&& c_rehash /etc/ssl/certs/

COPY ./001-01-bolao.maxmat1.com.br.conf /etc/apache2/sites-available/
COPY ./options-ssl-apache.conf /etc/letsencrypt
COPY ./bolao.maxmat1.com.br/* /etc/letsencrypt/live/bolao.maxmat1.com.br/
COPY ./bolao.maxmat1.com.br.conf /etc/letsencrypt/renewal/


RUN apt -y autoremove && \
    a2ensite 001-01-bolao.maxmat1.com.br.conf && \
    /etc/init.d/apache2 restart

EXPOSE 80
EXPOSE 443
CMD apachectl -D FOREGROUND ; cron -f
#CMD exec /usr/sbin/httpd -D FOREGROUND -f /etc/apache2/httpd.conf ; cron -f
