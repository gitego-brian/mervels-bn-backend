/* eslint-disable no-unused-vars */
/* eslint-disable class-methods-use-this */
import userService from '../services/userService';
import Password from '../utils/generatePassword';
import SessionManager from '../utils/sessionManager';
import Response from '../utils/response';
import Emails from '../utils/mails/email';
import supplierEmail from '../utils/mails/supplier.email';
import ResetPasswordEmail from '../utils/mails/resetPassord.email';
import VerifyEmail from '../utils/mails/verify.email';
/** Class representing a password util. */
class Users {
  /**
   * Generates a new password.
   * @param {object} req .
   * @param {object} res .
   * @param {object} next  details.
   * @returns {object}.
   */
  async createUser(req, res, next) {
    const rawData = req.body;
    try {
      const details = await userService.findUser({ userEmail: rawData.userEmail });
      if (details) {
        return Response.customResponse(res, 409, 'user already exists');
      }
      // generate a hashed password
      const obj = new Password(rawData);
      const newPassword = await obj.encryptPassword();
      // update data
      rawData.userPassword = newPassword;

      const data = await userService.createUser(rawData);
      const token = await SessionManager.generateToken({
        id: rawData.id,
        userEmail: rawData.userEmail,
        firstName: rawData.firstName,
        lastName: rawData.lastName,
        userRoles: rawData.userRoles,
        accountVerified: data.accountVerified
      });
      data.dataValues.userToken = token;
      delete data.userPassword;
      delete data.accountVerified;
      delete data.createdAt;
      delete data.updatedAt;
      const link = `${req.protocol}://${process.env.baseUrl}/api/v1/auth/verify/?token=${token}`;
      let verification;
      try {
        const header = Emails.header({
          to: data.dataValues.userEmail,
          subject: ' BareFoot email verification link '
        });
        const msg = VerifyEmail.verificationLinkTemplate(link, data.dataValues);
        const result = await Emails.sendmail({ ...header, ...msg });
        verification = 'Verification link sent';
      } catch (error) {
        verification = 'Verification link not sent';
      }
      return Response.customResponse(res, 201, 'Account has been created successfully', {
        ...data.dataValues,
        verification: { message: verification, link }
      });
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Generates a new password.
   * @param {object} req  details.
   * @param {object} res  details.
   * @returns {object}.
   */
  async socialLogin(req, res) {
    const userEmail = req.user.email;
    const { firstName, lastName } = req.user;
    const userRoles = 'Requester';
    let data;
    data = await userService.findUser({ userEmail });
    if (!data) {
      data = await userService.createUser({
        userEmail,
        firstName,
        lastName
      });
    }
    const token = await SessionManager.generateToken({
      id: data.id,
      email: data.userEmail,
      firstName: data.firstName,
      lastName: data.lastName,
      userRoles: data.userRoles
    });
    data.dataValues.userToken = token;
    delete data.userPassword;
    delete data.accountVerified;
    delete data.createdAt;
    delete data.updatedAt;
    return Response.customResponse(res, 200, 'Successfully logged in!', data.dataValues);
  }

  /**
   * Generates a new password.
   * @param {object} req  details.
   * @param {object} res  details.
   * @param {object} next next task
   * @returns {object}.
   */
  async sendLink(req, res, next) {
    const { userEmail } = req.body;
    const user = await userService.findUser({ userEmail });
    if (!user) {
      return Response.errorResponse(res, 404, 'this email is not registered');
    }

    const token = await SessionManager.generateToken(user);
    const link = `${req.protocol}://${process.env.baseUrl}/api/v1/auth/verify/?token=${token}`;
    try {
      const header = Emails.header({
        to: userEmail,
        subject: ' BareFoot email verification link '
      });
      const msg = VerifyEmail.verificationLinkTemplate(link, user);
      const _ = await Emails.sendmail({ ...header, ...msg });
      return Response.customResponse(res, 200, 'email sent with verification link', {
        userEmail,
        link
      });
    } catch (error) {
      return next({ message: 'error.message', stack: error.stack, status: 401 });
    }
  }

  /**
   * Generates a new password.
   * @param {object} req  details.
   * @param {object} res  details.
   * @param {object} next nest task
   * @returns {object}.
   */
  async verify(req, res, next) {
    const { token } = req.query;
    try {
      const { userEmail } = SessionManager.verify(token);
      const user = await userService.findUser({ userEmail });
      if (user.accountVerified) {
        return Response.errorResponse(res, 409, 'Email already verified', 'conflicts');
      }
      const result = userService.updateUser({ userEmail }, { accountVerified: true });
      return Response.customResponse(res, 201, 'Email verified succesfully', {
        userEmail
      });
    } catch (error) {
      return next({ message: 'error.message', stack: error.stack, status: 401 });
    }
  }

  /**
   * @param {object} req request
   * @param {object} res response
   * @param {object} next next
   * @return {function} logIn
   */
  async logIn(req, res, next) {
    try {
      const { userEmail, userPassword } = req.body;
      const userExists = await userService.findUser({ userEmail });

      if (!userExists) {
        return Response.errorResponse(res, 401, 'Invalid email or password entered');
      }
      if (userExists.accountVerified === false) {
        return res.status(401).send({ status: res.statusCode, error: 'Email not verified' });
      }
      const user = userExists.dataValues;

      const match = await Password.checkPasswordMatch(userPassword, user.userPassword);
      if (!match) {
        return Response.errorResponse(res, 401, 'Invalid email or password entered');
      }

      user.userToken = await SessionManager.createSession(user);
      delete user.userPassword;
      delete user.accountVerified;
      delete user.createdAt;
      delete user.updatedAt;

      return Response.customResponse(res, 200, 'User signed In successfully', user);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * Sends reset password email
   * @param {Object} req  request details.
   * @param {Object} res  response details.
   * @param {Object} next middleware details
   * @returns {Object}.
   */
  async requestPasswordReset(req, res, next) {
    const { email } = req.body;
    try {
      const userAccount = await userService.findUser({ userEmail: email });
      if (!userAccount) {
        return Response.customResponse(
          res,
          200,
          'If email is found, check your email for the link'
        );
      }
      const oneTimeToken = SessionManager.generateToken({
        id: userAccount.id,
        secret: `${userAccount.userPassword}-${userAccount.createdAt}`
      });
      const url = Emails.emailUrl({
        endpoint: 'resetPassword',
        userId: userAccount.id,
        token: oneTimeToken
      });
      const header = Emails.header({
        to: userAccount.userEmail,
        subject: ' BareFoot Password Reset '
      });
      const message = ResetPasswordEmail.resetPasswordTemplate(url, userAccount.firstName);
      const result = await Emails.sendmail({ ...header, ...message });
      return Response.customResponse(
        res,
        200,
        'If email is found, check your email for the link',
        url
      );
    } catch (error) {
      return next(error);
    }
  }

  /**
   * resets new password
   * @param {Object} req  request details.
   * @param {Object} res  response details.
   * @param {Object} next middleware details
   * @returns {Object}.
   */
  async resetPassword(req, res, next) {
    const { password, newPassword } = req.body;
    const { userId, token } = req.params;
    const id = parseInt(userId, 10);
    try {
      const userAccount = await userService.findUser({ id });
      if (!userAccount) {
        return Response.customResponse(res, 403, 'Forbidden Request');
      }
      const userDetails = SessionManager.decodeToken({
        token,
        secret: `${userAccount.userPassword}-${userAccount.createdAt}`
      });
      if (password !== newPassword) {
        return Response.customResponse(res, 400, 'Passwords do not match re-type password');
      }
      const pass = new Password({ userPassword: password });
      const userPassword = await pass.encryptPassword();
      const updatedUser = await userService.updateUser(
        { id: userDetails.id },
        {
          userPassword
        }
      );
      return Response.customResponse(
        res,
        200,
        'Password has been sucessfully changed. Proceed to login'
      );
    } catch (error) {
      return next(error);
    }
  }

  /** logs out user
   * @param {Object} req  request data.
   * @param {Object} res  response data.
   * @returns {Object}.
   */
  async logout(req, res) {
    const deleted = await SessionManager.destroyToken(req.user);

    return Response.customResponse(res, 200, 'User logged out successfully');
  }

  /**
   * updates User Role
   * @param {Object} req  request data.
   * @param {Object} res  response data.
   * @param {Object} next middleware data
   * @returns {Object}.
   */
  async updateUserRole(req, res, next) {
    const rawData = req.body;
    let message, data, updateData;

    try {
      const details = await userService.findUser({ userEmail: rawData.userEmail });
      if (!details) {
        return Response.customResponse(res, 404, "user doesn't exist");
      }
      if (details.userRoles === 'Super Administrator') {
        return Response.customResponse(
          res,
          400,
          'What you are trying achieve can not be completed'
        );
      }
      if (rawData.userRole !== details.userRoles) {
        if (rawData.userRole === 'Manager') {
          const roleDetails = await userService.findUser({ userRoles: rawData.userRole });
          if (!roleDetails) {
            message = 'User Role has been successfully updated';
            data = await userService.updateUser(
              { userEmail: rawData.userEmail },
              { userRoles: rawData.userRole }
            );
            return Response.customResponse(res, 200, message);
          }
          data = await userService.updateUser(
            { userEmail: roleDetails.userEmail },
            { userRoles: 'Requester' }
          );
          updateData = await userService.updateUser(
            { userEmail: rawData.userEmail },
            { userRoles: rawData.userRole }
          );
          message = `${roleDetails.firstName} ${roleDetails.lastName}'s role has been\
 updated to Requester and the new manager role has been assigned to ${rawData.userEmail}`;
          return Response.customResponse(res, 200, message);
        }
        data = await userService.updateUser(
          { userEmail: rawData.userEmail },
          { userRoles: rawData.userRole }
        );
        return Response.customResponse(res, 404, message);
      }
      message = 'The user already has the rights you are trying to assign';
      return Response.customResponse(res, 409, message);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * adds new user by super admin only
   * @param {Object} req  request details.
   * @param {Object} res  response details.
   * @param {Object} next middleware details
   * @returns {Object}.
   */
  async addSupplier(req, res, next) {
    try {
      const user = await userService.findUser({ userEmail: req.body.userEmail });
      if (user) {
        return Response.customResponse(res, 409, 'user already exists');
      }
      const userPassword = Password.randomPassword();
      const obj = new Password({ userPassword });
      const password = await obj.encryptPassword();
      const supplier = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        userEmail: req.body.userEmail,
        userPassword: password,
        userRoles: 'Accommodation Supplier',
        accountVerified: true
      };
      const data = await userService.createUser(supplier);
      const header = Emails.header({ to: req.body.userEmail, subject: 'BareFoot Accomodations' });
      const message = supplierEmail.supplierTemplate({
        email: req.body.userEmail,
        name: req.body.firstName,
        password: userPassword
      });
      const result = await Emails.sendmail({ ...header, ...message });
      return Response.customResponse(res, 201, 'Account has been created successfully', data);
    } catch (error) {
      return next(error);
    }
  }
}
export default new Users();
